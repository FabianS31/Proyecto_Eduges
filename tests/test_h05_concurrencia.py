"""H05 exclusivamente en un PostgreSQL 17 nuevo y descartable, sin .env.

Ejecutar con --baseline antes de corregir, o sin argumentos para la solución.
"""
from pathlib import Path
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


def ejecutar():
    binarios = Path(r'C:\Program Files\PostgreSQL\17\bin')
    entorno = {k: v for k, v in os.environ.items() if not k.upper().startswith('PG')}
    flags = subprocess.CREATE_NO_WINDOW
    version = subprocess.check_output([str(binarios / 'postgres.exe'), '--version'],
                                      env=entorno, creationflags=flags, text=True)
    assert ' 17.' in version, version
    raiz = Path(tempfile.mkdtemp(prefix='eduges-h05-')).resolve()
    datos = raiz / 'datos'
    assert raiz.parent == Path(tempfile.gettempdir()).resolve()
    assert raiz.name.startswith('eduges-h05-') and not datos.exists()
    password = secrets.token_urlsafe(24)
    clave = raiz / 'clave-ficticia.txt'
    clave.write_text(password, encoding='ascii')
    iniciado = False
    detenido = False

    def comando(programa, *args):
        with (raiz / 'comando.log').open('wb') as log:
            result = subprocess.run([str(binarios / programa), *map(str, args)],
                stdout=log, stderr=subprocess.STDOUT, env=entorno, creationflags=flags, timeout=45)
        if result.returncode:
            raise RuntimeError((raiz / 'comando.log').read_text(errors='replace'))

    try:
        comando('initdb.exe', '-D', datos, '-U', 'eduges_h05_ficticio',
                '--auth=scram-sha-256', '--pwfile', clave, '--no-locale', '--encoding=UTF8')
        clave.unlink()
        with socket.socket() as reserva:
            reserva.bind(('127.0.0.1', 0))
            puerto = reserva.getsockname()[1]
        assert puerto != 5432
        print(f'{version.strip()}; clúster NUEVO={datos}; loopback=127.0.0.1:{puerto}', flush=True)
        iniciado = True
        comando('pg_ctl.exe', '-D', datos, '-l', raiz / 'postgres.log', '-o',
                f'-h 127.0.0.1 -p {puerto}', '-w', 'start')
        return probar(puerto, datos, password)
    finally:
        if iniciado:
            comando('pg_ctl.exe', '-D', datos, '-m', 'fast', '-w', 'stop')
            detenido = not (datos / 'postmaster.pid').exists()
            assert detenido, 'No eliminar: el servidor sigue activo.'
            print('Servidor temporal detenido; postmaster.pid ausente.', flush=True)
        if not iniciado or detenido:
            assert raiz.resolve().parent == Path(tempfile.gettempdir()).resolve()
            assert raiz.name.startswith('eduges-h05-') and datos.resolve().parent == raiz
            shutil.rmtree(raiz)
            assert not raiz.exists()
            print(f'Eliminado solamente el directorio temporal verificado: {raiz}', flush=True)


def probar(puerto, directorio, password):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'SistemaEduGes/Backend'))
    from django.conf import settings
    settings.configure(SECRET_KEY='solo-h05-ficticio',
        INSTALLED_APPS=['usuarios', 'profesionales', 'pacientes', 'turnos'],
        DATABASES={'default': {'ENGINE': 'django.db.backends.postgresql', 'HOST': '127.0.0.1',
            'PORT': puerto, 'NAME': 'postgres', 'USER': 'eduges_h05_ficticio', 'PASSWORD': password,
            'OPTIONS': {'options': '-c statement_timeout=12000 -c lock_timeout=10000'}}},
        REST_FRAMEWORK={'UNAUTHENTICATED_USER': None}, USE_TZ=True)
    import django
    django.setup()
    from django.apps import apps
    from django.db import connection, connections, IntegrityError
    from rest_framework.test import APIRequestFactory, force_authenticate
    from APIs.obras_sociales.views import ObraSocialListView, ObraSocialDetailView
    from APIs.obras_sociales.serializers.obra_social_serializer import ObraSocialSerializer
    from APIs.obras_sociales.services.obra_social_service import ObraSocialService
    from pacientes.models.obra_social_model import ObraSocial, EstadoObraSocial, TipoObraSocial
    from usuarios.models.usuario_model import Usuario
    from usuarios.models.rol_model import Rol
    with connection.cursor() as cursor:
        cursor.execute('SHOW data_directory')
        assert Path(cursor.fetchone()[0]).resolve() == directorio.resolve()
        cursor.execute('SHOW listen_addresses')
        assert cursor.fetchone()[0] == '127.0.0.1'
        cursor.execute('SHOW transaction_isolation')
        assert cursor.fetchone()[0] == 'read committed'
    print('Identidad del clúster, loopback y aislamiento READ COMMITTED verificados antes de DDL.', flush=True)
    with connection.schema_editor() as schema:
        for modelo in apps.get_models():
            schema.create_model(modelo)
    estado = EstadoObraSocial.objects.create(descripcion='Activa')
    tipo = TipoObraSocial.objects.create(tipo='Ficticio')
    usuario = Usuario.objects.create(usuario='h05_ficticio', password='!', activo=True,
        rol=Rol.objects.create(rol='SuperAdministrador'))
    baseline = '--baseline' in sys.argv

    class ConcurrenciaTests(unittest.TestCase):
        def setUp(self):
            ObraSocial.objects.all().delete()

        def solicitud(self, nombre=None, pk=None, **extras):
            cuerpo = dict(extras)
            if nombre is not None:
                cuerpo['nombre'] = nombre
            factory = APIRequestFactory()
            request = (factory.post if pk is None else factory.patch)('/', cuerpo, format='json')
            force_authenticate(request, user=usuario)
            view = ObraSocialListView.as_view() if pk is None else ObraSocialDetailView.as_view()
            return view(request, **({} if pk is None else {'obra_social_id': pk}))

        def paralelo(self, primera, segunda, rollback=False):
            resultados, errores, pids = {}, [], {}
            listo, liberar = threading.Event(), threading.Event()
            cerrar = threading.Event()
            terminadas = {nombre: threading.Event() for nombre in ('a', 'b')}
            barrera = threading.Barrier(2)
            original_validar = ObraSocialSerializer.validate_nombre
            original_guardar = ObraSocialSerializer.save

            def validar(serializer, value):
                resultado = original_validar(serializer, value)
                barrera.wait(6)
                return resultado

            def guardar(serializer, **kwargs):
                resultado = original_guardar(serializer, **kwargs)
                if threading.current_thread().name == 'h05-primera':
                    listo.set()
                    if not liberar.wait(8):
                        raise RuntimeError('No se liberó la prueba')
                    if rollback:
                        raise IntegrityError('Error ficticio posterior a escritura')
                return resultado

            def worker(nombre, operacion):
                try:
                    with connection.cursor() as c:
                        c.execute('SELECT pg_backend_pid()')
                        pids[nombre] = c.fetchone()[0]
                    resultados[nombre] = operacion()
                except Exception as error:
                    errores.append(error)
                finally:
                    terminadas[nombre].set()
                    cerrar.wait(12)
                    connections.close_all()

            with patch.object(ObraSocialSerializer, 'validate_nombre', validar if baseline else original_validar), \
                 patch.object(ObraSocialSerializer, 'save', original_guardar if baseline else guardar), \
                 patch('APIs.obras_sociales.views.logger.exception'):
                a = threading.Thread(target=worker, args=('a', primera), name='h05-primera')
                b = threading.Thread(target=worker, args=('b', segunda), name='h05-segunda')
                a.start()
                try:
                    if not baseline:
                        self.assertTrue(listo.wait(6), errores)
                    b.start()
                    if not baseline:
                        esperando = False
                        limite = time.monotonic() + 6
                        while time.monotonic() < limite:
                            if 'b' in pids:
                                with connection.cursor() as c:
                                    c.execute('SELECT wait_event FROM pg_stat_activity WHERE pid=%s', [pids['b']])
                                    fila = c.fetchone()
                                if fila and fila[0] == 'advisory':
                                    esperando = True
                                    break
                            time.sleep(.02)
                        self.assertTrue(esperando, 'La segunda conexión no esperó un bloqueo asesor')
                finally:
                    liberar.set()
                    # Mantener ambas sesiones abiertas: demostrar liberación por
                    # COMMIT/ROLLBACK, no como consecuencia de desconectarse.
                    completas = terminadas['a'].wait(10)
                    if b.ident is not None:
                        completas = terminadas['b'].wait(10) and completas
                    cerrar.set()
                    a.join(15)
                    if b.ident is not None:
                        b.join(15)
                self.assertFalse(a.is_alive() or b.is_alive())
                self.assertTrue(completas, 'Una operación no terminó con las sesiones abiertas')
                self.assertFalse(errores, errores)
            self.assertEqual(len(set(pids.values())), 2)
            print(f'  PIDs independientes={pids}; respuestas={[r.status_code for r in resultados.values()]}', flush=True)
            return resultados

        def escenario(self, modo, equivalentes):
            uno = ObraSocial.objects.create(nombre='Original uno', estado=estado, tipo=tipo) if modo != 'altas' else None
            dos = ObraSocial.objects.create(nombre='Original dos', estado=estado, tipo=tipo) if modo == 'ediciones' else None
            primero = None if modo != 'ediciones' else uno.pk
            segundo = None if modo == 'altas' else (dos or uno).pk
            nombre = '  MÉDICA Ficticia  ' if equivalentes else 'Medica Ficticia'
            r = self.paralelo(lambda: self.solicitud(nombre, primero),
                              lambda: self.solicitud('Medica Ficticia', segundo, contacto='No persistir'))
            if baseline:
                self.assertTrue(all(x.status_code in (200, 201) for x in r.values()))
            else:
                self.assertIn(r['a'].status_code, (200, 201))
                self.assertEqual(r['b'].status_code, 400, r['b'].data)
                self.assertIn('nombre', r['b'].data)
                self.assertFalse(ObraSocial.objects.filter(contacto='No persistir').exists())
            equivalentes_guardados = sum(ObraSocialService.normalizar_nombre(x.nombre) == 'medica ficticia'
                                        for x in ObraSocial.objects.all())
            self.assertEqual(equivalentes_guardados, 2 if baseline else 1)

        def test_altas_iguales(self):
            self.escenario('altas', False)

        def test_altas_equivalentes(self):
            self.escenario('altas', True)

        def test_alta_y_edicion(self):
            self.escenario('mixto', True)

        def test_dos_ediciones(self):
            self.escenario('ediciones', True)

        @unittest.skipIf(baseline, 'Solo solución')
        def test_error_revierte_y_libera_bloqueo(self):
            r = self.paralelo(lambda: self.solicitud('Reversible'),
                              lambda: self.solicitud('Reversible'), rollback=True)
            self.assertEqual(r['a'].status_code, 500)
            self.assertEqual(r['b'].status_code, 201)
            self.assertEqual(ObraSocial.objects.filter(nombre='Reversible').count(), 1)
            self.assertEqual(self.solicitud('Normal posterior').status_code, 201)

        @unittest.skipIf(baseline, 'Solo solución')
        def test_ediciones_misma_fila_no_pierden_cambios(self):
            obj = ObraSocial.objects.create(nombre='Original', tipo=tipo, estado=estado)
            r = self.paralelo(lambda: self.solicitud('Nombre nuevo', obj.pk),
                              lambda: self.solicitud(pk=obj.pk, contacto='Contacto nuevo'))
            self.assertEqual([r[k].status_code for k in ('a', 'b')], [200, 200])
            obj.refresh_from_db()
            self.assertEqual((obj.nombre, obj.contacto), ('Nombre nuevo', 'Contacto nuevo'))

    try:
        resultado = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ConcurrenciaTests))
        return resultado.wasSuccessful()
    finally:
        connections.close_all()


if __name__ == '__main__':
    sys.exit(0 if ejecutar() else 1)
