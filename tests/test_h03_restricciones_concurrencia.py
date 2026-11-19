"""Diagnóstico H03, PostgreSQL 17 descartable. No modifica producción ni otras suites.

Reutiliza el lanzador H05 y fixtures/concurrencia H10 mediante un adaptador local
del runner. Las aserciones documentan el comportamiento observado, INCLUIDOS
defectos: que la suite apruebe NO significa que la regla institucional se cumpla.
Solo replica las restricciones indicadas, no todo el esquema de Supabase.
"""
from datetime import date, timedelta
from types import ModuleType
import sys
import unittest
import uuid
from unittest.mock import patch
import test_h05_concurrencia as cluster
import test_h10_concurrencia as h10

RUN = unittest.TextTestRunner.run


def diagnostico(runner, suite):
    from django.conf import settings
    from django.db import connection, transaction, IntegrityError
    from django.urls import path
    from django.utils import timezone
    from rest_framework.test import APIClient
    from rest_framework.response import Response
    from rest_framework.exceptions import ValidationError
    from pacientes.models import Paciente, Tutor, PacienteTutor
    from pacientes.models.paciente_model import EstadoPaciente
    from profesionales.models.profesional_model import Profesional, Especialidad
    from profesionales.models.asignacion_model import AsignacionProfesional as Asignacion
    from usuarios.models.usuario_model import Usuario
    from turnos.models import Turno, EstadoTurno, RegistroSesion
    from APIs.tutores.views import RelacionTutorDetailView, TutorListCreateView
    from APIs.profesionales.views import ReasignacionPacienteView
    from APIs.turnos.services.turno_service import TurnoService
    from APIs.servicios.estado_entidad_service import EstadoEntidadService
    from APIs.sesiones.services.sesiones_services import SesionesService

    settings.TIME_ZONE='America/Argentina/Buenos_Aires'
    settings.ALLOWED_HOSTS=['testserver']
    urls=ModuleType('h03_urls_ficticias')
    urls.urlpatterns=[path('relacion/<int:pk>/',RelacionTutorDetailView.as_view()),
                     path('tutores/',TutorListCreateView.as_view())]
    sys.modules[urls.__name__]=urls
    settings.ROOT_URLCONF=urls.__name__
    ddl=[
        'CREATE UNIQUE INDEX uq_paciente_responsable_principal ON public.pacientes_tutores USING btree ("ID_Paciente") WHERE ("ResponsablePrincipal" = true)',
        'CREATE UNIQUE INDEX uq_turno_profesional_fecha_hora ON public.turnos USING btree ("ID_Profesional", "Fecha", "Hora") WHERE ("ID_EstadoTurno" = ANY (ARRAY[1, 2]))',
        'CREATE UNIQUE INDEX uq_turno_registro_sesion ON public.turnos USING btree ("ID_RegistroSesion") WHERE ("ID_RegistroSesion" IS NOT NULL)',
        'ALTER TABLE public.asignaciones_profesionales ADD CONSTRAINT h03_fechas CHECK ("FechaFin" IS NULL OR "FechaFin" >= "FechaInicio")',
    ]
    with connection.cursor() as cursor:
        for sql in ddl:cursor.execute(sql)
        cursor.execute("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname IN ('uq_paciente_responsable_principal','uq_turno_profesional_fecha_hora','uq_turno_registro_sesion') ORDER BY indexname")
        for fila in cursor.fetchall():print('INDICE VERIFICADO:',fila,flush=True)
        cursor.execute("SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal")
        assert cursor.fetchone()[0]==0
    for pk,nombre in enumerate(('Pendiente','Confirmado','Cancelado','Realizado','Ausente'),1):
        EstadoTurno.objects.create(pk=pk,estado=nombre)
    EstadoPaciente.objects.get_or_create(estado='Inactivo')
    base=list(suite)[0].__class__

    class DiagnosticoTests(base):
        def snapshot(self):
            return {m.__name__:list(m.objects.order_by('pk').values()) for m in
                    (Paciente,Tutor,PacienteTutor,Asignacion,Turno,RegistroSesion)}

        def resultado(self,caso,via,esperado,obtenido,falla=False):
            print(f'H03 {caso} | {via} | esperado={esperado} | obtenido={obtenido} | FALLA={falla}',flush=True)

        def historico(self):
            PacienteTutor.objects.filter(pk=self.principales[0].pk).update(activo=False)

        def promover(self,relacion=None):
            return self.request(RelacionTutorDetailView,'patch',{'responsable_principal':True},pk=(relacion or self.relaciones[0]).pk)

        def nuevo_profesional(self,especialidad=None):
            anterior=Profesional.objects.get(usuario=self.pro)
            marca=uuid.uuid4().hex[:12]
            usuario=Usuario.objects.create(usuario=marca,password='!',activo=True,rol=self.pro.rol)
            return Profesional.objects.create(nombre='Ficticio',apellido='Prueba',dni=marca,matricula=marca,
                usuario=usuario,rol=self.pro.rol,especialidad=especialidad or Especialidad.objects.create(especialidad=marca),
                estado_profesional=anterior.estado_profesional)

        def insertar_sql(self,profesional,paciente=None):
            with connection.cursor() as c:
                c.execute('INSERT INTO asignaciones_profesionales ("ID_Paciente","ID_Profesional","FechaInicio","FechaFin") VALUES (%s,%s,%s,NULL)',
                          [(paciente or self.pacientes[0]).pk,profesional.pk,timezone.localdate()])
            return Response(status=201)

        def reasignar(self,origen,destino):
            return self.request(ReasignacionPacienteView,'post',{'profesional_id':destino.pk},
                actor=origen.usuario,paciente_id=self.pacientes[0].pk)

        def test_h03_a_reemplazo_y_desvinculacion(self):
            self.assertEqual(self.reemplazar().status_code,200)
            r=self.request(RelacionTutorDetailView,'delete',{},pk=self.principales[0].pk)
            self.assertEqual(r.status_code,200);self.principales[0].refresh_from_db()
            self.assertFalse(self.principales[0].activo);self.assertFalse(self.principales[0].responsable_principal)
            self.resultado('A1-A2','API','reemplazar y desvincular','200/200')

        def test_h03_a_historico_promocion_http500_y_rollback(self):
            self.historico();antes=self.snapshot()
            client=APIClient();client.force_authenticate(user=self.admin);client.raise_request_exception=False
            r=client.patch(f'/relacion/{self.relaciones[0].pk}/',{'responsable_principal':True},format='json')
            self.assertEqual(r.status_code,500);self.assertEqual(self.snapshot(),antes)
            self.resultado('A3-A4-A7','HTTP API','error controlado sin mutaciones','500; rollback completo',True)

        def test_h03_a_alta_tutor_revierte_tambien_al_tutor(self):
            self.historico();antes=self.snapshot()
            client=APIClient();client.force_authenticate(user=self.admin);client.raise_request_exception=False
            r=client.post('/tutores/',{'nombre':'Ficticio','apellido':'Prueba','dni':'98765432','telefono':'123',
                'mail':'ficticio@example.com','domicilio':'Domicilio ficticio',
                'paciente_id':self.pacientes[0].pk,'parentesco_id':self.parentesco.pk,'responsable_principal':True},format='json')
            self.assertEqual(r.status_code,500,getattr(r,'data',None));self.assertEqual(self.snapshot(),antes)
            self.resultado('A7 alta integral tutor/relación','HTTP API','error controlado','500 sin tutor parcial',True)

        def test_h03_a_reactivar_mismo_principal_historico(self):
            self.historico()
            r=self.request(RelacionTutorDetailView,'patch',{'activo':True},pk=self.principales[0].pk)
            self.assertEqual(r.status_code,200);self.verificar()
            self.resultado('A5 mismo principal','API','reactivar','200')

        def test_h03_a_reactivar_otro_como_principal(self):
            self.historico();PacienteTutor.objects.filter(pk=self.relaciones[0].pk).update(activo=False)
            antes=self.snapshot()
            with self.assertRaises(IntegrityError) as error:
                self.reactivar()
            self.assertEqual(error.exception.__cause__.diag.constraint_name,'uq_paciente_responsable_principal')
            self.assertEqual(self.snapshot(),antes)
            self.resultado('A5 otro principal','APIView','rechazo controlado','IntegrityError no controlado',True)

        def test_h03_a_promociones_concurrentes(self):
            PacienteTutor.objects.filter(pk=self.principales[0].pk).update(responsable_principal=False)
            _,codigos=self.paralelo(self.promover,lambda:self.promover(self.principales[0]))
            self.assertEqual(codigos,[200,400]);self.verificar()
            self.resultado('A6','API concurrente','un principal','200/400 con espera real')

        def test_h03_b_sql_distintas_especialidades(self):
            b=self.nuevo_profesional();self.insertar_sql(b)
            self.assertEqual(Asignacion.objects.filter(paciente=self.pacientes[0],fecha_fin__isnull=True).count(),2)
            self.resultado('B1','SQL','permitir distintas especialidades','2 activas')

        def test_h03_b_sql_misma_especialidad(self):
            a=Profesional.objects.get(usuario=self.pro);b=self.nuevo_profesional(a.especialidad)
            self.insertar_sql(b)
            self.assertEqual(Asignacion.objects.filter(paciente=self.pacientes[0],fecha_fin__isnull=True).count(),2)
            self.resultado('B2 garantía física','SQL','no duplicar institucionalmente','SQL admite 2; no hay restricción física',True)

        def test_h03_b_reasignar_hacia_especialidad_ocupada(self):
            a=Profesional.objects.get(usuario=self.pro);b=self.nuevo_profesional();c=self.nuevo_profesional(b.especialidad)
            self.insertar_sql(b);r=self.reasignar(a,c)
            self.assertEqual(r.status_code,200,r.data)
            self.assertEqual(Asignacion.objects.filter(paciente=self.pacientes[0],fecha_fin__isnull=True,profesional__especialidad=b.especialidad).count(),2)
            self.resultado('B3','API','rechazar duplicidad de especialidad','200; B y C activos en la misma especialidad',True)

        def test_h03_b_reasignacion_valida_conserva_otras(self):
            a=Profesional.objects.get(usuario=self.pro);b=self.nuevo_profesional();c=self.nuevo_profesional(a.especialidad)
            self.insertar_sql(b);antes=list(Asignacion.objects.filter(profesional=b).values())
            self.assertEqual(self.reasignar(a,c).status_code,200)
            self.assertEqual(list(Asignacion.objects.filter(profesional=b).values()),antes)
            self.asignacion.refresh_from_db();self.assertEqual(self.asignacion.fecha_fin,timezone.localdate())
            self.resultado('B4-B9','API','cerrar A, abrir C, conservar B','correcto, historial preservado')

        def preparar_inactivo(self):
            Asignacion.objects.filter(pk=self.asignacion.pk).update(fecha_fin=timezone.localdate())
            Paciente.objects.filter(pk=self.pacientes[0].pk).update(estado=EstadoPaciente.objects.get(estado='Inactivo'))

        def test_h03_b_reactivacion_historica(self):
            self.preparar_inactivo();a=Profesional.objects.get(usuario=self.pro)
            EstadoEntidadService.cambiar_estado_paciente(self.pacientes[0].pk,'Activo',a)
            self.assertEqual(Asignacion.objects.filter(paciente=self.pacientes[0],fecha_fin__isnull=True).count(),1)
            self.asignacion.refresh_from_db();self.assertIsNotNone(self.asignacion.fecha_fin)
            self.resultado('B5','servicio','reactivar con nueva asignación e historial intacto','correcto')

        def test_h03_b_reactivacion_otra_especialidad_activa(self):
            a=Profesional.objects.get(usuario=self.pro);b=self.nuevo_profesional()
            self.insertar_sql(b)
            # Hacer que A sea el último responsable según el criterio del servicio.
            Asignacion.objects.filter(profesional=b).update(fecha_inicio=date(2019,1,1))
            self.preparar_inactivo();antes=self.snapshot()
            with self.assertRaises(ValidationError) as error:
                EstadoEntidadService.cambiar_estado_paciente(self.pacientes[0].pk,'Activo',a)
            self.assertIn('asignación activa',str(error.exception));self.assertEqual(self.snapshot(),antes)
            self.resultado('B6','servicio','distinguir especialidades; situación histórica a decidir','rechazo global de asignación activa; sin cambios',True)

        def test_h03_b_dos_asignaciones_sql_concurrentes(self):
            a=self.nuevo_profesional();b=self.nuevo_profesional(a.especialidad)
            _,codigos=self.paralelo(lambda:self.insertar_sql(a,self.pacientes[2]),lambda:self.insertar_sql(b,self.pacientes[2]),espera=False)
            self.assertEqual(codigos,[201,201])
            self.assertEqual(Asignacion.objects.filter(paciente=self.pacientes[2],fecha_fin__isnull=True).count(),2)
            self.resultado('B7','SQL concurrente','no duplicidad','ambas transacciones guardan',True)

        def test_h03_b_dos_reasignaciones_api_concurrentes(self):
            a=Profesional.objects.get(usuario=self.pro);b=self.nuevo_profesional();self.insertar_sql(b)
            c=self.nuevo_profesional();d=self.nuevo_profesional(c.especialidad)
            _,codigos=self.paralelo(lambda:self.reasignar(a,c),lambda:self.reasignar(b,d))
            self.assertEqual(codigos,[200,200])
            self.assertEqual(Asignacion.objects.filter(paciente=self.pacientes[0],fecha_fin__isnull=True,profesional__especialidad=c.especialidad).count(),2)
            self.resultado('B8','API concurrente','rechazar segundo destino de igual especialidad','200/200 pese a serialización por paciente',True)

        def test_h03_b_permiso_y_rollback_transferencia(self):
            a=Profesional.objects.get(usuario=self.pro);c=self.nuevo_profesional();antes=self.snapshot()
            r=self.request(ReasignacionPacienteView,'post',{'profesional_id':c.pk},actor=self.admin,paciente_id=self.pacientes[0].pk)
            self.assertEqual(r.status_code,400);self.assertEqual(self.snapshot(),antes)
            Turno.objects.create(paciente=self.pacientes[0],profesional=a,fecha=timezone.localdate()+timedelta(days=2),hora='12:00',estado_id=1)
            antes=self.snapshot()
            with patch.object(TurnoService,'buscar_horario_disponible',side_effect=ValidationError('Conflicto ficticio después de actualizar asignaciones')):
                r=self.reasignar(a,c)
            self.assertEqual(r.status_code,400);self.assertEqual(self.snapshot(),antes)
            self.resultado('B10','API con fallo inyectado','denegar y revertir cierre/alta de asignaciones','400; snapshot intacto')

        def test_h03_b_check_fechas(self):
            antes=self.snapshot()
            with self.assertRaises(IntegrityError),transaction.atomic():
                Asignacion.objects.filter(pk=self.asignacion.pk).update(fecha_fin=date(1900,1,1))
            self.assertEqual(self.snapshot(),antes)
            self.resultado('CHECK fechas','SQL ORM','rechazar fin anterior','IntegrityError y rollback')

        def test_h03_b_baja_profesional_conserva_otra_especialidad(self):
            from profesionales.models.estados_profesionales_model import EstadoProfesional
            EstadoProfesional.objects.get_or_create(estado='Inactivo')
            a=Profesional.objects.get(usuario=self.pro);b=self.nuevo_profesional();self.insertar_sql(b)
            antes=list(Asignacion.objects.filter(profesional=b).values())
            EstadoEntidadService.cambiar_estado_profesional(a.pk,'Inactivo')
            self.assertEqual(list(Asignacion.objects.filter(profesional=b).values()),antes)
            self.asignacion.refresh_from_db();self.assertIsNotNone(self.asignacion.fecha_fin)
            EstadoEntidadService.cambiar_estado_profesional(a.pk,'Activo')
            self.assertFalse(Asignacion.objects.filter(profesional=a,fecha_fin__isnull=True).exists())
            self.resultado('B9 baja/reactivación profesional','servicio','cerrar solo A; no restaurar asignaciones automáticamente','correcto; B intacto')

        def test_h03_b_baja_paciente_cierra_todas_sin_borrar_historia(self):
            b=self.nuevo_profesional();self.insertar_sql(b)
            ids=list(Asignacion.objects.filter(paciente=self.pacientes[0]).values_list('pk',flat=True))
            EstadoEntidadService.cambiar_estado_paciente(self.pacientes[0].pk,'Inactivo')
            self.assertFalse(Asignacion.objects.filter(paciente=self.pacientes[0],fecha_fin__isnull=True).exists())
            self.assertEqual(Asignacion.objects.filter(pk__in=ids).count(),2)
            self.resultado('B9 baja paciente','servicio','cerrar todas las asignaciones conservando filas','correcto')

        def test_h03_c_turnos_cancelado_y_solapamiento(self):
            a=Profesional.objects.get(usuario=self.pro);fecha=timezone.localdate()+timedelta(days=2)
            anterior=Turno.objects.create(paciente=self.pacientes[0],profesional=a,fecha=fecha,hora='12:00',estado_id=3)
            nuevo=TurnoService.crear_turno(fecha=fecha,hora=__import__('datetime').time(12),paciente_id=self.pacientes[0].pk,usuario=self.pro)
            self.assertNotEqual(nuevo.pk,anterior.pk)
            with self.assertRaises(ValidationError):
                TurnoService.crear_turno(fecha=fecha,hora=__import__('datetime').time(12,20),paciente_id=self.pacientes[0].pk,usuario=self.pro)
            with self.assertRaises(IntegrityError),transaction.atomic():
                Turno.objects.create(paciente=self.pacientes[0],profesional=a,fecha=fecha,hora='12:00',estado_id=2)
            self.resultado('C turnos','servicio + SQL','reusar cancelado; bloquear solapamiento y duplicado activo','correcto')

        def test_h03_c_sesion_unica_y_servicio(self):
            a=Profesional.objects.get(usuario=self.pro)
            t=Turno.objects.create(paciente=self.pacientes[0],profesional=a,fecha=timezone.localdate()-timedelta(days=1),hora='12:00',estado_id=4)
            registro=SesionesService.registrar_sesion(turno_id=t.pk,trabajo_sesion='Ficticio',diagnostico='Ficticio',nota_sesion=None,usuario=self.pro)
            antes=self.snapshot()
            with self.assertRaises(ValidationError):
                SesionesService.registrar_sesion(turno_id=t.pk,trabajo_sesion='Ficticio',diagnostico='Ficticio',nota_sesion=None,usuario=self.pro)
            with self.assertRaises(IntegrityError),transaction.atomic():
                Turno.objects.create(paciente=self.pacientes[1],profesional=a,fecha=t.fecha,hora='14:00',estado_id=4,registro_sesion=registro)
            self.assertEqual(self.snapshot(),antes)
            self.resultado('C sesiones','servicio + SQL','sesión nueva única; no reutilizar registro','correcto, sin escrituras parciales')

    return RUN(runner,unittest.defaultTestLoader.loadTestsFromTestCase(DiagnosticoTests))


if __name__=='__main__':
    cluster.probar=h10.probar
    with patch.object(unittest.TextTestRunner,'run',diagnostico):
        sys.exit(0 if cluster.ejecutar() else 1)
