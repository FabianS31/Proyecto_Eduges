"""PostgreSQL efímero: requiere sus binarios locales, no usa .env ni bases existentes.

Ejecutar: venv/Scripts/python.exe -B tests/test_tutores_concurrencia.py
Crea y elimina un clúster temporal en loopback/puerto libre; nunca ejecuta migraciones.
"""
from pathlib import Path
from datetime import date
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid


def ejecutar():
    binarios = Path(r'C:\Program Files\PostgreSQL\17\bin')
    if not (binarios / 'initdb.exe').exists():
        raise SystemExit('No hay binarios PostgreSQL locales para la prueba aislada.')
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    with tempfile.TemporaryDirectory(prefix='eduges-etapa4a-') as temporal:
        raiz = Path(temporal).resolve()
        assert raiz.parent == Path(tempfile.gettempdir()).resolve() and raiz.name.startswith('eduges-etapa4a-')
        datos = raiz / 'datos'
        def comando(programa, *args):
            # PostgreSQL en Windows hereda handles: un pipe puede quedar abierto en el servidor.
            salida = raiz / 'comando.log'
            with salida.open('wb') as log:
                result = subprocess.run([str(binarios / programa), *map(str, args)], stdout=log,
                                        stderr=subprocess.STDOUT, creationflags=flags, timeout=40)
            if result.returncode:
                raise RuntimeError(salida.read_text(errors='replace'))
        comando('initdb.exe', '-D', datos, '-U', 'eduges_pruebas', '-A', 'trust', '--no-locale', '--encoding=UTF8')
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            puerto = s.getsockname()[1]
        iniciado = False
        try:
            print(f'PostgreSQL aislado: {datos}, puerto {puerto}', flush=True)
            iniciado = True
            comando('pg_ctl.exe', '-D', datos, '-l', raiz / 'postgres.log', '-o',
                    f'-h 127.0.0.1 -p {puerto} -F', '-w', 'start')
            resultado = probar(puerto, datos)
        finally:
            if iniciado:
                comando('pg_ctl.exe', '-D', datos, '-m', 'fast', '-w', 'stop')
    return resultado


def probar(puerto, directorio):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'SistemaEduGes/Backend'))
    from django.conf import settings
    settings.configure(
        SECRET_KEY='solo-pruebas-concurrencia', INSTALLED_APPS=['usuarios','profesionales','pacientes','turnos'],
        DATABASES={'default': {'ENGINE':'django.db.backends.postgresql', 'HOST':'127.0.0.1',
            'PORT':puerto, 'NAME':'postgres', 'USER':'eduges_pruebas',
            'OPTIONS':{'options':'-c statement_timeout=10000 -c lock_timeout=8000'}}},
        USE_TZ=True,
    )
    import django
    django.setup()
    from django.apps import apps
    from django.db import connection, connections, transaction
    from rest_framework.exceptions import ValidationError, PermissionDenied
    from usuarios.models.rol_model import Rol
    from usuarios.models.usuario_model import Usuario
    from profesionales.models.profesional_model import Profesional, Especialidad
    from profesionales.models.estados_profesionales_model import EstadoProfesional
    from profesionales.models.asignacion_model import AsignacionProfesional
    from pacientes.models import Paciente, Tutor, PacienteTutor, Parentesco
    from pacientes.models.paciente_model import EstadoPaciente
    from pacientes.models.obra_social_model import ObraSocial, EstadoObraSocial, TipoObraSocial
    from APIs.tutores.services import TutorService
    with connection.cursor() as cursor:
        cursor.execute('SHOW data_directory')
        assert Path(cursor.fetchone()[0]).resolve() == directorio.resolve()
    with connection.schema_editor() as schema:
        for modelo in apps.get_models():
            schema.create_model(modelo)

    class ConcurrenciaTests(unittest.TestCase):
        def setUp(self):
            sufijo = uuid.uuid4().hex[:8]
            rol, _ = Rol.objects.get_or_create(rol='Profesional')
            self.usuario = Usuario.objects.create(usuario=sufijo, password='!', rol=rol, activo=True)
            pro = Profesional.objects.create(nombre='Ficticio', apellido='Prueba', dni=sufijo, matricula=sufijo,
                especialidad=Especialidad.objects.create(especialidad=sufijo), rol=rol, usuario=self.usuario,
                estado_profesional=EstadoProfesional.objects.get_or_create(estado='Activo')[0])
            obra = ObraSocial.objects.create(nombre=sufijo, tipo=TipoObraSocial.objects.create(tipo=sufijo),
                estado=EstadoObraSocial.objects.get_or_create(descripcion='Activa')[0])
            self.paciente = Paciente.objects.create(nombre='Ficticio', apellido='Prueba', dni=sufijo,
                fecha_nacimiento=date(2010,1,1), direccion='Ficticia', consentimiento=True, obra_social=obra,
                numero_afiliado=sufijo, estado=EstadoPaciente.objects.get_or_create(estado='Activo')[0])
            self.asignacion = AsignacionProfesional.objects.create(paciente=self.paciente, profesional=pro, fecha_inicio=date.today())
            self.parentesco = Parentesco.objects.create(descripcion=sufijo)
            self.relaciones = [PacienteTutor.objects.create(
                paciente=self.paciente, tutor=Tutor.objects.create(nombre='Tutor', apellido='Prueba', dni=sufijo+str(i)),
                parentesco=self.parentesco, activo=True, responsable_principal=i==0,
            ) for i in range(3)]

        def simultaneas(self, primera, segunda):
            listo, liberar = threading.Event(), threading.Event()
            resultados, errores, segundo_pid = [], [], []
            def worker1():
                try:
                    with transaction.atomic():
                        primera()
                        listo.set()
                        if not liberar.wait(6):
                            raise RuntimeError('Tiempo agotado en prueba')
                except Exception as error:
                    errores.append(error)
                    listo.set()
                finally:
                    connections.close_all()
            def worker2():
                try:
                    with connection.cursor() as cursor:
                        cursor.execute('SELECT pg_backend_pid()')
                        segundo_pid.append(cursor.fetchone()[0])
                    segunda()
                    resultados.append('ok')
                except (ValidationError, PermissionDenied) as error:
                    resultados.append(type(error).__name__)
                except Exception as error:
                    errores.append(error)
                finally:
                    connections.close_all()
            a = threading.Thread(target=worker1)
            b = threading.Thread(target=worker2)
            a.start()
            try:
                self.assertTrue(listo.wait(5))
                b.start()
                bloqueada = False
                limite = time.monotonic()+4
                while time.monotonic()<limite and b.is_alive():
                    if segundo_pid:
                        with connection.cursor() as cursor:
                            cursor.execute('SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s', [segundo_pid[0]])
                            row = cursor.fetchone()
                            if row and row[0]=='Lock':
                                bloqueada = True
                                break
                    time.sleep(.02)
                self.assertTrue(bloqueada, 'La segunda transacción debe esperar el bloqueo PostgreSQL')
            finally:
                liberar.set()
                a.join(10)
                if b.ident:
                    b.join(10)
            self.assertFalse(a.is_alive() or b.is_alive())
            self.assertEqual(errores, [])
            return resultados

        def test_dos_reemplazos_no_crean_dos_principales(self):
            anterior, nuevo, otro = self.relaciones
            r = self.simultaneas(
                lambda: TutorService.reemplazar_principal(anterior, nuevo.pk, self.usuario),
                lambda: TutorService.reemplazar_principal(anterior, otro.pk, self.usuario))
            self.assertEqual(r, ['ValidationError'])
            self.assertEqual(list(PacienteTutor.objects.filter(paciente=self.paciente, activo=True,
                responsable_principal=True).values_list('pk', flat=True)), [nuevo.pk])

        def test_baja_espera_reemplazo_y_rechaza_nuevo_principal(self):
            anterior, nuevo, _ = self.relaciones
            r = self.simultaneas(
                lambda: TutorService.reemplazar_principal(anterior, nuevo.pk, self.usuario),
                lambda: TutorService.dar_baja_relacion(nuevo, self.usuario))
            self.assertEqual(r, ['ValidationError'])
            nuevo.refresh_from_db()
            self.assertTrue(nuevo.activo and nuevo.responsable_principal)

        def test_dos_altas_principales_se_serializan(self):
            PacienteTutor.objects.filter(paciente=self.paciente).update(responsable_principal=False)
            tutores = [Tutor.objects.create(nombre='Alta', apellido='Prueba', dni=uuid.uuid4().hex[:20]) for _ in range(2)]
            datos = dict(paciente=self.paciente, parentesco=self.parentesco, responsable_principal=True)
            r = self.simultaneas(
                lambda: TutorService.crear_relacion(tutores[0], datos, self.usuario),
                lambda: TutorService.crear_relacion(tutores[1], datos, self.usuario))
            self.assertEqual(r, ['ValidationError'])
            self.assertEqual(PacienteTutor.objects.filter(paciente=self.paciente, activo=True,responsable_principal=True).count(),1)

        def test_autorizacion_se_revalida_tras_bloqueo(self):
            def finalizar():
                Paciente.objects.select_for_update().get(pk=self.paciente.pk)
                AsignacionProfesional.objects.filter(pk=self.asignacion.pk).update(fecha_fin=date.today())
            r = self.simultaneas(finalizar,
                lambda: TutorService.reemplazar_principal(self.relaciones[0], self.relaciones[1].pk, self.usuario))
            self.assertEqual(r, ['PermissionDenied'])
            self.relaciones[0].refresh_from_db()
            self.assertTrue(self.relaciones[0].responsable_principal)

    resultado = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ConcurrenciaTests))
    connections.close_all()
    return resultado.wasSuccessful()


if __name__ == '__main__':
    sys.exit(0 if ejecutar() else 1)
