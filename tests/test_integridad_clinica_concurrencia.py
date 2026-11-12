"""Concurrencia 5 en cluster PostgreSQL temporal; nunca carga .env ni config.settings."""
import sys
import threading
import time
import unittest
import uuid
from datetime import date, time as hora, timedelta
from pathlib import Path
from unittest.mock import patch
import test_tutores_concurrencia as cluster


def probar(puerto, directorio):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'SistemaEduGes/Backend'))
    from django.conf import settings
    settings.configure(SECRET_KEY='pruebas-aisladas',
        INSTALLED_APPS=['usuarios','profesionales','pacientes','turnos'],
        DATABASES={'default': {'ENGINE':'django.db.backends.postgresql','HOST':'127.0.0.1',
            'PORT':puerto,'NAME':'postgres','USER':'eduges_pruebas',
            'OPTIONS':{'options':'-c statement_timeout=10000 -c lock_timeout=8000'}}},
        USE_TZ=True, TIME_ZONE='America/Argentina/Buenos_Aires')
    import django
    django.setup()
    from django.apps import apps
    from django.db import connection, connections, transaction
    from django.utils import timezone
    from rest_framework.exceptions import ValidationError, PermissionDenied
    from usuarios.models.rol_model import Rol
    from usuarios.models.usuario_model import Usuario
    from profesionales.models.profesional_model import Profesional, Especialidad
    from profesionales.models.estados_profesionales_model import EstadoProfesional
    from profesionales.models.asignacion_model import AsignacionProfesional
    from pacientes.models import Paciente
    from pacientes.models.paciente_model import EstadoPaciente
    from pacientes.models.obra_social_model import ObraSocial, EstadoObraSocial, TipoObraSocial
    from turnos.models import Turno, EstadoTurno, RegistroSesion
    from APIs.turnos.services.turno_service import TurnoService
    from APIs.sesiones.services.sesiones_services import SesionesService
    from APIs.servicios.estado_entidad_service import EstadoEntidadService
    with connection.cursor() as cursor:
        cursor.execute('SHOW data_directory')
        assert Path(cursor.fetchone()[0]).resolve() == directorio.resolve()
    with connection.schema_editor() as schema:
        for modelo in apps.get_models(): schema.create_model(modelo)

    class ConcurrenciaTests(unittest.TestCase):
        def setUp(self):
            marca=uuid.uuid4().hex[:10]
            rol=Rol.objects.get_or_create(rol='Profesional')[0]
            estado=EstadoProfesional.objects.get_or_create(estado='Activo')[0]
            esp=Especialidad.objects.create(especialidad=marca)
            self.usuarios=[]; self.profesionales=[]
            for i in range(2):
                u=Usuario.objects.create(usuario=marca+str(i),password='!',rol=rol,activo=True)
                self.usuarios.append(u)
                self.profesionales.append(Profesional.objects.create(nombre='Prueba',apellido=str(i),
                    dni=marca+str(i),matricula=marca+str(i),especialidad=esp,rol=rol,usuario=u,estado_profesional=estado))
            obra=ObraSocial.objects.create(nombre=marca,tipo=TipoObraSocial.objects.create(tipo=marca),
                estado=EstadoObraSocial.objects.get_or_create(descripcion='Activa')[0])
            self.paciente=Paciente.objects.create(nombre='Prueba',apellido='Paciente',dni=marca,
                fecha_nacimiento=date(2010,1,1),direccion='Prueba',consentimiento=True,obra_social=obra,
                numero_afiliado=marca,estado=EstadoPaciente.objects.get_or_create(estado='Activo')[0])
            self.asignacion=AsignacionProfesional.objects.create(paciente=self.paciente,
                profesional=self.profesionales[0],fecha_inicio=timezone.localdate())
            self.turno=Turno.objects.create(paciente=self.paciente,profesional=self.profesionales[0],
                fecha=timezone.localdate()+timedelta(days=2),hora=hora(9),
                estado=EstadoTurno.objects.get_or_create(estado='Pendiente')[0])

        def sesion(self):
            return SesionesService.registrar_sesion(turno_id=self.turno.pk,usuario=self.usuarios[0],
                trabajo_sesion='Original',diagnostico='Original',nota_sesion='Original')

        def editar(self):
            return TurnoService.editar_turno(turno_id=self.turno.pk,fecha=self.turno.fecha,
                hora=hora(11),paciente_id=self.paciente.pk,usuario=self.usuarios[0])

        def reasignar(self):
            return TurnoService.reasignar_paciente(paciente_id=self.paciente.pk,
                profesional_destino_id=self.profesionales[1].pk,usuario=self.usuarios[0])

        def simultaneas(self, primera, segunda):
            listo, liberar=threading.Event(),threading.Event()
            errores=[]; resultados=[]; pid=[]
            def a():
                try:
                    with transaction.atomic():
                        primera(); listo.set()
                        if not liberar.wait(6): raise RuntimeError('Tiempo agotado')
                except Exception as e: errores.append(e); listo.set()
                finally: connections.close_all()
            def b():
                try:
                    with connection.cursor() as c:
                        c.execute('SELECT pg_backend_pid()'); pid.append(c.fetchone()[0])
                    segunda(); resultados.append('ok')
                except (ValidationError,PermissionDenied) as e: resultados.append(type(e).__name__)
                except Exception as e: errores.append(e)
                finally: connections.close_all()
            primero=threading.Thread(target=a); segundo=threading.Thread(target=b)
            primero.start()
            try:
                self.assertTrue(listo.wait(5)); segundo.start()
                espera=False; limite=time.monotonic()+4
                while segundo.is_alive() and time.monotonic()<limite:
                    if pid:
                        with connection.cursor() as c:
                            c.execute('SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s',[pid[0]])
                            fila=c.fetchone()
                            if fila and fila[0]=='Lock': espera=True; break
                    time.sleep(.02)
                self.assertTrue(espera,'Debe esperar un bloqueo real de PostgreSQL')
            finally:
                liberar.set(); primero.join(10)
                if segundo.ident: segundo.join(10)
            self.assertFalse(primero.is_alive() or segundo.is_alive())
            self.assertEqual(errores,[])
            return resultados

        def test_sesion_primero_impide_editar(self):
            self.assertEqual(self.simultaneas(self.sesion,self.editar),['ValidationError'])
            self.turno.refresh_from_db()
            self.assertEqual(self.turno.hora,hora(9)); self.assertIsNotNone(self.turno.registro_sesion_id)

        def test_editar_primero_sesion_usa_turno_final(self):
            self.assertEqual(self.simultaneas(self.editar,self.sesion),['ok'])
            self.turno.refresh_from_db()
            self.assertEqual(self.turno.hora,hora(11)); self.assertIsNotNone(self.turno.registro_sesion_id)

        def test_sesion_primero_impide_reasignar_sin_parciales(self):
            self.assertEqual(self.simultaneas(self.sesion,self.reasignar),['ValidationError'])
            self.turno.refresh_from_db(); self.asignacion.refresh_from_db()
            self.assertIsNone(self.asignacion.fecha_fin)
            self.assertEqual(AsignacionProfesional.objects.filter(paciente=self.paciente).count(),1)
            self.assertEqual(self.turno.profesional_id,self.profesionales[0].pk)
            self.assertEqual(self.turno.registro_sesion.trabajo_sesion,'Original')

        def test_reasignar_primero_revalida_autor_de_sesion(self):
            self.assertEqual(self.simultaneas(self.reasignar,self.sesion),['PermissionDenied'])
            self.turno.refresh_from_db()
            self.assertEqual(self.turno.profesional_id,self.profesionales[1].pk)
            self.assertIsNone(self.turno.registro_sesion_id)

        def test_editar_y_reasignar_sin_deadlock(self):
            self.assertEqual(self.simultaneas(self.editar,self.reasignar),['ok'])
            self.turno.refresh_from_db()
            self.assertEqual(self.turno.hora,hora(11))
            self.assertEqual(self.turno.profesional_id,self.profesionales[1].pk)

        def test_reasignar_y_editar_rechaza_lectura_anterior(self):
            self.assertEqual(self.simultaneas(self.reasignar,self.editar),['ValidationError'])
            self.turno.refresh_from_db()
            self.assertEqual(self.turno.hora,hora(9))
            self.assertEqual(self.turno.profesional_id,self.profesionales[1].pk)

        def test_rollback_real_de_transferencia(self):
            with patch.object(Turno,'save',side_effect=RuntimeError('fallo')):
                with self.assertRaises(RuntimeError): self.reasignar()
            self.asignacion.refresh_from_db(); self.turno.refresh_from_db()
            self.assertIsNone(self.asignacion.fecha_fin)
            self.assertEqual(AsignacionProfesional.objects.filter(paciente=self.paciente).count(),1)
            self.assertEqual(self.turno.profesional_id,self.profesionales[0].pk)

        def preparar_asistencia(self):
            self.turno.fecha=timezone.localdate()-timedelta(days=1)
            self.turno.estado=EstadoTurno.objects.get_or_create(estado='Confirmado')[0]
            self.turno.save()

        def cambiar(self, estado):
            destino=EstadoTurno.objects.get_or_create(estado=estado)[0]
            return TurnoService.cambiar_estado_turno(turno_id=self.turno.pk,
                estado_id=destino.pk,usuario=self.usuarios[0])

        def test_sesion_concurrente_impide_ausencia(self):
            self.preparar_asistencia()
            self.assertEqual(self.simultaneas(self.sesion,lambda:self.cambiar('Ausente')),['ValidationError'])
            self.turno.refresh_from_db()
            self.assertEqual(self.turno.estado.estado,'Confirmado')
            self.assertIsNotNone(self.turno.registro_sesion_id)

        def test_ausencia_concurrente_impide_sesion(self):
            self.preparar_asistencia()
            self.assertEqual(self.simultaneas(lambda:self.cambiar('Ausente'),self.sesion),['ValidationError'])
            self.turno.refresh_from_db()
            self.assertEqual(self.turno.estado.estado,'Ausente')
            self.assertIsNone(self.turno.registro_sesion_id)

        def test_sesion_concurrente_impide_cancelacion(self):
            EstadoTurno.objects.get_or_create(estado='Cancelado')
            self.assertEqual(self.simultaneas(self.sesion,lambda:TurnoService.cancelar_turno(
                turno_id=self.turno.pk,usuario=self.usuarios[0])),['ValidationError'])
            self.turno.refresh_from_db()
            self.assertEqual(self.turno.estado.estado,'Pendiente')
            self.assertIsNotNone(self.turno.registro_sesion_id)

        def test_cancelacion_concurrente_impide_sesion(self):
            EstadoTurno.objects.get_or_create(estado='Cancelado')
            self.assertEqual(self.simultaneas(lambda:TurnoService.cancelar_turno(
                turno_id=self.turno.pk,usuario=self.usuarios[0]),self.sesion),['ValidationError'])
            self.turno.refresh_from_db()
            self.assertEqual(self.turno.estado.estado,'Cancelado')
            self.assertIsNone(self.turno.registro_sesion_id)

        def inhabilitar(self):
            EstadoPaciente.objects.get_or_create(estado='Inactivo')
            EstadoTurno.objects.get_or_create(estado='Cancelado')
            return EstadoEntidadService.cambiar_estado_paciente(self.paciente.pk,'Inactivo',self.profesionales[0])

        def test_sesion_concurrente_rechaza_inhabilitacion_completa(self):
            self.assertEqual(self.simultaneas(self.sesion,self.inhabilitar),['ValidationError'])
            self.paciente.refresh_from_db(); self.turno.refresh_from_db(); self.asignacion.refresh_from_db()
            self.assertEqual(self.paciente.estado.estado,'Activo')
            self.assertEqual(self.turno.estado.estado,'Pendiente')
            self.assertIsNone(self.asignacion.fecha_fin)
            self.assertIsNotNone(self.turno.registro_sesion_id)

        def test_inhabilitacion_concurrente_impide_sesion_nueva(self):
            self.assertEqual(self.simultaneas(self.inhabilitar,self.sesion),['ValidationError'])
            self.paciente.refresh_from_db(); self.turno.refresh_from_db()
            self.assertEqual(self.paciente.estado.estado,'Inactivo')
            self.assertEqual(self.turno.estado.estado,'Cancelado')
            self.assertIsNone(self.turno.registro_sesion_id)

        def reservar(self, multiple=False, administrador=False):
            usuario=self.usuarios[0]
            if administrador:
                rol=Rol.objects.get_or_create(rol='Administrador')[0]
                usuario=Usuario.objects.create(usuario=uuid.uuid4().hex[:15],password='!',rol=rol,activo=True)
            datos=dict(paciente_id=self.paciente.pk,profesional_id=self.profesionales[0].pk,usuario=usuario)
            fechas=[{'fecha':self.turno.fecha+timedelta(days=i),'hora':hora(14)} for i in (1,2)]
            if multiple: return TurnoService.crear_turnos(turnos=fechas,**datos)
            return TurnoService.crear_turno(**fechas[0],**datos)

        def test_etapa6_reasignacion_antes_de_alta_revalida_responsable(self):
            self.assertEqual(self.simultaneas(self.reasignar,self.reservar),['ValidationError'])
            self.assertEqual(Turno.objects.filter(paciente=self.paciente).count(),1)

        def test_etapa6_reasignacion_antes_de_lote_admin_no_deja_parciales(self):
            self.assertEqual(self.simultaneas(self.reasignar,lambda:self.reservar(True,True)),['ValidationError'])
            self.assertEqual(Turno.objects.filter(paciente=self.paciente).count(),1)

        def test_etapa6_alta_antes_de_reasignar_transfiere_tambien_nuevo_turno(self):
            self.assertEqual(self.simultaneas(self.reservar,self.reasignar),['ok'])
            turnos=Turno.objects.filter(paciente=self.paciente)
            self.assertEqual(turnos.count(),2)
            self.assertEqual(set(turnos.values_list('profesional_id',flat=True)),{self.profesionales[1].pk})

        def test_etapa6_lote_antes_de_reasignar_transfiere_todo(self):
            self.assertEqual(self.simultaneas(lambda:self.reservar(True),self.reasignar),['ok'])
            turnos=Turno.objects.filter(paciente=self.paciente)
            self.assertEqual(turnos.count(),3)
            self.assertEqual(set(turnos.values_list('profesional_id',flat=True)),{self.profesionales[1].pk})

        def test_etapa6_edicion_relee_fecha_inicio_despues_de_esperar(self):
            def cambiar_inicio():
                Paciente.objects.select_for_update().get(pk=self.paciente.pk)
                AsignacionProfesional.objects.filter(pk=self.asignacion.pk).update(
                    fecha_inicio=self.turno.fecha+timedelta(days=1))
            self.assertEqual(self.simultaneas(cambiar_inicio,self.editar),['ValidationError'])
            self.turno.refresh_from_db()
            self.assertEqual(self.turno.hora,hora(9))

    try:
        return unittest.TextTestRunner(verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(ConcurrenciaTests)).wasSuccessful()
    finally:
        connections.close_all()


if __name__ == '__main__':
    cluster.probar=probar
    sys.exit(0 if cluster.ejecutar() else 1)
