"""S1: Client con CSRF habilitado, autenticaci?n real y SQLite :memory:.
Ejecutar: venv/Scripts/python.exe -B tests/test_seguridad_csrf.py
No carga .env/config.settings, no utiliza red ni ejecuta migraciones.
"""
from datetime import date, timedelta
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'SistemaEduGes/Backend'))
from django.conf import settings
settings.configure(
    SECRET_KEY='clave-ficticia-solo-para-tests-csrf',
    INSTALLED_APPS=['usuarios', 'profesionales', 'pacientes', 'turnos'],
    DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}},
    ROOT_URLCONF='config.urls', ALLOWED_HOSTS=['testserver'],
    MIDDLEWARE=[
        'django.contrib.sessions.middleware.SessionMiddleware',
        'django.middleware.csrf.CsrfViewMiddleware',
    ],
    SESSION_ENGINE='django.contrib.sessions.backends.cache',
    SESSION_SAVE_EVERY_REQUEST=True, SESSION_COOKIE_AGE=1200,
    CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
                        'LOCATION': 'tests-csrf-aislados'}},
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    REST_FRAMEWORK={
        'UNAUTHENTICATED_USER': None,
        'DEFAULT_AUTHENTICATION_CLASSES': [
            'APIs.autenticacion.autenticacion.UsuarioSessionAuthentication',
        ],
    },
    USE_TZ=True, TIME_ZONE='America/Argentina/Buenos_Aires',
    TEMPLATES=[{'BACKEND': 'django.template.backends.django.DjangoTemplates', 'APP_DIRS': True}],
)
import django
django.setup()
from django.apps import apps
from django.contrib.auth.hashers import make_password, check_password
from django.core.cache import cache
from django.db import connection, transaction
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from django.urls import get_resolver, URLResolver
from usuarios.models.usuario_model import Usuario
from usuarios.models.rol_model import Rol
from profesionales.models.profesional_model import Profesional, Especialidad
from profesionales.models.estados_profesionales_model import EstadoProfesional
from profesionales.models.asignacion_model import AsignacionProfesional
from pacientes.models import Paciente, Tutor, PacienteTutor, Parentesco
from pacientes.models.paciente_model import EstadoPaciente
from pacientes.models.obra_social_model import ObraSocial, EstadoObraSocial, TipoObraSocial
from turnos.models import Turno, EstadoTurno, RegistroSesion


class SeguridadCSRFTests(unittest.TestCase):
    password = 'ClaveFicticia123'

    @classmethod
    def setUpClass(cls):
        cls.modelos = list(apps.get_models())
        with connection.schema_editor() as schema:
            for modelo in cls.modelos:
                schema.create_model(modelo)

    def setUp(self):
        cache.clear()
        self.atomic = transaction.atomic()
        self.atomic.__enter__()
        self.addCleanup(self.rollback)
        self.roles = {r: Rol.objects.create(rol=r) for r in (
            'Profesional', 'Administrador', 'SuperAdministrador', 'Otro',
        )}
        self.usuarios = {}
        for nombre, rol in (
            ('A', 'Profesional'), ('B', 'Profesional'), ('sin_vinculo', 'Profesional'),
            ('admin', 'Administrador'), ('super', 'SuperAdministrador'), ('otro', 'Otro'),
        ):
            self.usuarios[nombre] = Usuario.objects.create(
                usuario=f'ficticio_{nombre}', password=make_password(self.password),
                activo=True, rol=self.roles[rol],
            )
        especialidad = Especialidad.objects.create(especialidad='Especialidad ficticia')
        estado_prof = EstadoProfesional.objects.create(estado='Activo')
        self.profesionales = {
            nombre: Profesional.objects.create(
                nombre=nombre, apellido='Ficticio', dni=f'TEST-{nombre}',
                matricula=f'MAT-{nombre}', especialidad=especialidad,
                rol=self.roles['Profesional'], usuario=self.usuarios[nombre],
                estado_profesional=estado_prof,
            ) for nombre in ('A', 'B')
        }
        obra = ObraSocial.objects.create(
            nombre='Obra ficticia',
            estado=EstadoObraSocial.objects.create(descripcion='Activa'),
            tipo=TipoObraSocial.objects.create(tipo='Ficticio'),
        )
        estado_pac = EstadoPaciente.objects.create(estado='Activo')
        self.pacientes = {}
        for nombre in ('A', 'B'):
            paciente = Paciente.objects.create(
                nombre=f'Paciente {nombre}', apellido='Ficticio', dni=f'PAC-{nombre}',
                fecha_nacimiento=date(2010, 1, 1), direccion='Domicilio ficticio',
                consentimiento=True, obra_social=obra, numero_afiliado=f'AF-{nombre}',
                estado=estado_pac,
            )
            self.pacientes[nombre] = paciente
            AsignacionProfesional.objects.create(
                paciente=paciente, profesional=self.profesionales[nombre],
                fecha_inicio=date(2026, 1, 1),
            )
        self.parentesco = Parentesco.objects.create(descripcion='Tutor ficticio')
        self.otro_parentesco = Parentesco.objects.create(descripcion='Otro parentesco')
        self.tutor = Tutor.objects.create(
            nombre='Tutor', apellido='Ficticio', dni='TUT-001',
            mail='ficticio@example.invalid', domicilio='Domicilio ficticio',
        )
        self.relacion = PacienteTutor.objects.create(
            tutor=self.tutor, paciente=self.pacientes['B'], parentesco=self.parentesco,
            responsable_principal=False, activo=True,
        )
        self.url = f'/api/tutores/relaciones/{self.relacion.pk}/'

        EstadoPaciente.objects.create(estado='Inactivo')
        EstadoProfesional.objects.create(estado='Inactivo')
        self.estados_turno = {nombre: EstadoTurno.objects.create(estado=nombre)
                              for nombre in ('Pendiente', 'Confirmado', 'Cancelado', 'Realizado')}
        self.fecha = (timezone.localdate() + timedelta(days=2)).isoformat()
        self.turno = Turno.objects.create(
            paciente=self.pacientes['B'], profesional=self.profesionales['B'],
            fecha=self.fecha, hora='09:00', estado=self.estados_turno['Pendiente'],
        )
        self.registro = RegistroSesion.objects.create(
            trabajo_sesion='Trabajo ficticio', diagnostico='Diagnóstico ficticio',
        )
        self.turno_registrado = Turno.objects.create(
            paciente=self.pacientes['B'], profesional=self.profesionales['B'],
            fecha=timezone.localdate() - timedelta(days=2), hora='09:00',
            estado=self.estados_turno['Realizado'], registro_sesion=self.registro,
        )

    def rollback(self):
        transaction.set_rollback(True)
        self.atomic.__exit__(None, None, None)
        cache.clear()

    def login(self, usuario='super'):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.get('/api/auth/csrf/').status_code, 204)
        response = client.post('/api/auth/login/', {
            'usuario': self.usuarios[usuario].usuario, 'password': self.password,
        }, content_type='application/json', HTTP_X_CSRFTOKEN=self.token(client))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(client.session['usuario_id'], self.usuarios[usuario].pk)
        self.assertEqual(client.get('/api/auth/me/').status_code, 200)
        return client

    @staticmethod
    def token(client):
        return client.cookies['csrftoken'].value

    def snapshot(self):
        return {m._meta.label: list(m.objects.order_by('pk').values()) for m in self.modelos}

    def enviar(self, client, metodo, ruta, datos=None, **headers):
        return getattr(client, metodo)(ruta, datos or {}, content_type='application/json', **headers)

    def rechazo_csrf(self, client, metodo, ruta, datos, **headers):
        antes = self.snapshot()
        actividad = client.session.get('_last_activity')
        with CaptureQueriesContext(connection) as consultas:
            respuesta = self.enviar(client, metodo, ruta, datos, **headers)
        self.assertEqual(respuesta.status_code, 403, respuesta.content)
        self.assertEqual(self.snapshot(), antes)
        self.assertEqual(client.session.get('_last_activity'), actividad)
        escrituras = [q['sql'] for q in consultas if q['sql'].lstrip().split()[0].upper()
                      in ('INSERT', 'UPDATE', 'DELETE', 'REPLACE')]
        self.assertEqual(escrituras, [])
        # Distinguir el rechazo CSRF de un 403 por permisos.
        self.assertIn(b'CSRF', respuesta.content)

    def casos(self):
        pro = self.profesionales['B'].pk
        pac = self.pacientes['B'].pk
        datos_prof = {
            'nombre': 'Nombre actualizado', 'apellido': 'Ficticio',
            'dni': 'TEST-B', 'matricula': 'MAT-B',
            'especialidad': self.profesionales['B'].especialidad_id,
            'rol': self.roles['Profesional'].pk,
        }
        obra = self.pacientes['B'].obra_social_id
        return [
            ('post', '/api/profesionales/', {**datos_prof, 'dni': 'TEST-NUEVO',
             'matricula': 'MAT-NUEVA', 'usuario': 'nuevo_ficticio', 'password': self.password}, 'super'),
            ('put', f'/api/profesionales/{pro}/', datos_prof, 'super'),
            ('patch', f'/api/profesionales/{pro}/', {'nombre': 'Nombre actualizado'}, 'super'),
            ('patch', f'/api/profesionales/{pro}/estado/', {'estado': 'Inactivo'}, 'super'),
            ('post', f'/api/profesionales/pacientes/{pac}/reasignar/',
             {'profesional_id': self.profesionales['A'].pk}, 'B'),
            ('post', '/api/pacientes/', {'nombre': 'Nuevo', 'apellido': 'Ficticio',
             'dni': 'PAC-NUEVO', 'fecha_nacimiento': '2010-01-01', 'direccion': 'Ficticia',
             'consentimiento': True, 'obra_social': obra, 'numero_afiliado': 'AF-NUEVO',
             'profesional': pro}, 'super'),
            ('patch', f'/api/pacientes/{pac}/estado/', {'estado': 'Inactivo'}, 'B'),
            ('post', '/api/turnos/', {'paciente': pac, 'profesional': pro,
             'fecha': self.fecha, 'hora': '14:00'}, 'super'),
            ('put', f'/api/turnos/{self.turno.pk}/',
             {'paciente': pac, 'fecha': self.fecha, 'hora': '14:00'}, 'super'),
            ('patch', f'/api/turnos/{self.turno.pk}/', {'hora': '14:00'}, 'super'),
            ('delete', f'/api/turnos/{self.turno.pk}/', {}, 'super'),
            ('patch', f'/api/turnos/{self.turno.pk}/estado/',
             {'ID_EstadoTurno': self.estados_turno['Confirmado'].pk}, 'super'),
            ('post', '/api/tutores/', {'nombre': 'Nuevo tutor', 'apellido': 'Ficticio',
             'dni': 'TUT-NUEVO', 'mail': 'nuevo@example.invalid', 'domicilio': 'Ficticio',
             'paciente_id': pac, 'parentesco_id': self.parentesco.pk}, 'B'),
            ('patch', f'/api/tutores/{self.tutor.pk}/', {'nombre': 'Nombre actualizado'}, 'B'),
            ('patch', self.url, {'parentesco_id': self.otro_parentesco.pk}, 'B'),
            ('delete', self.url, {}, 'B'),
            ('post', '/api/sesiones/', {'turno_id': self.turno.pk,
             'trabajo_sesion': 'Trabajo ficticio nuevo', 'diagnostico': 'Diagnóstico ficticio'}, 'B'),
            ('patch', f'/api/sesiones/{self.turno_registrado.pk}/',
             {'trabajo_sesion': 'Trabajo actualizado ficticio'}, 'B'),
            ('post', '/api/obras-sociales/', {'nombre': 'Obra ficticia nueva'}, 'super'),
            ('patch', f'/api/obras-sociales/{obra}/', {'nombre': 'Obra ficticia actualizada'}, 'super'),
            ('post', '/api/profesionales/especialidades/', {'nombre': 'Especialidad nueva'}, 'super'),
            ('post', '/api/auth/administradores/',
             {'usuario': 'nuevo_administrador', 'password': self.password}, 'super'),
        ]

    def test_inventario_de_22_operaciones(self):
        def recorrer(patrones, prefijo=''):
            for patron in patrones:
                ruta = prefijo + str(patron.pattern)
                if isinstance(patron, URLResolver):
                    yield from recorrer(patron.url_patterns, ruta)
                else:
                    vista = getattr(patron.callback, 'view_class', None)
                    if vista and ruta.startswith('api/') and (
                        not ruta.startswith('api/auth/') or ruta == 'api/auth/administradores/'
                    ):
                        for metodo in ('post', 'put', 'patch', 'delete'):
                            if hasattr(vista, metodo):
                                yield metodo, ruta
        import re
        normalizar = lambda ruta: re.sub(r'<[^>]+>|\d+', '{id}', ruta.lstrip('/'))
        self.assertCountEqual(
            [(m, normalizar(r)) for m, r in recorrer(get_resolver().url_patterns)],
            [(m, normalizar(r)) for m, r, _, _ in self.casos()],
        )

    def test_login_csrf_y_credenciales(self):
        client = Client(enforce_csrf_checks=True)
        datos = {'usuario': self.usuarios['super'].usuario, 'password': self.password}
        self.rechazo_csrf(client, 'post', '/api/auth/login/', datos)
        client.get('/api/auth/csrf/')
        self.rechazo_csrf(client, 'post', '/api/auth/login/', datos, HTTP_X_CSRFTOKEN='invalido')
        respuesta = self.enviar(client, 'post', '/api/auth/login/',
                               {**datos, 'password': 'incorrecta'}, HTTP_X_CSRFTOKEN=self.token(client))
        self.assertEqual(respuesta.status_code, 400)
        self.assertNotIn('usuario_id', client.session)
        respuesta = self.enviar(client, 'post', '/api/auth/login/', datos,
                               HTTP_X_CSRFTOKEN=self.token(client))
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(client.session['usuario_id'], self.usuarios['super'].pk)

    def test_logout_rechazado_conserva_sesion_y_valido_la_cierra(self):
        client = self.login()
        for token in (None, 'invalido'):
            self.rechazo_csrf(client, 'post', '/api/auth/logout/', {},
                              **({'HTTP_X_CSRFTOKEN': token} if token else {}))
            self.assertIn('usuario_id', client.session)
        self.assertEqual(self.enviar(client, 'post', '/api/auth/logout/',
                         HTTP_X_CSRFTOKEN=self.token(client)).status_code, 204)
        self.assertNotIn('usuario_id', client.session)
        self.assertEqual(client.get('/api/auth/me/').status_code, 401)

    def test_cambio_password_rechazado_y_valido(self):
        client = self.login()
        datos = {'password_actual': self.password, 'password_nueva': 'NuevaFicticia123'}
        for token in (None, 'invalido'):
            self.rechazo_csrf(client, 'post', '/api/auth/cambiar-password/', datos,
                              **({'HTTP_X_CSRFTOKEN': token} if token else {}))
        self.assertEqual(self.enviar(client, 'post', '/api/auth/cambiar-password/', datos,
                         HTTP_X_CSRFTOKEN=self.token(client)).status_code, 200)
        self.usuarios['super'].refresh_from_db()
        self.assertTrue(check_password(datos['password_nueva'], self.usuarios['super'].password))

    def test_origen_http_https_y_referer(self):
        client = self.login()
        ruta = f'/api/tutores/{self.tutor.pk}/'
        token = self.token(client)
        for seguro, headers in (
            (False, {'HTTP_ORIGIN': 'https://ajeno.invalid'}),
            (True, {'HTTP_ORIGIN': 'http://testserver'}),
            (True, {'HTTP_REFERER': 'https://ajeno.invalid/'}),
            (True, {}),
        ):
            with self.subTest(seguro=seguro, headers=headers):
                self.rechazo_csrf(client, 'patch', ruta, {'nombre': 'No guardar'},
                                  secure=seguro, HTTP_X_CSRFTOKEN=token, **headers)
        for seguro, headers in (
            (False, {'HTTP_ORIGIN': 'http://testserver'}),
            (True, {'HTTP_ORIGIN': 'https://testserver'}),
            (True, {'HTTP_REFERER': 'https://testserver/pacientes/'}),
        ):
            with self.subTest(seguro=seguro, headers=headers):
                respuesta = self.enviar(client, 'patch', ruta, {'nombre': 'Permitido'},
                                        secure=seguro, HTTP_X_CSRFTOKEN=token, **headers)
                self.assertEqual(respuesta.status_code, 200, respuesta.content)

    def test_metodos_seguros_sin_cookie_csrf(self):
        client = self.login()
        del client.cookies['csrftoken']
        for metodo in ('get', 'head', 'options'):
            self.assertEqual(getattr(client, metodo)('/api/tutores/').status_code, 200)
        for ruta in ('/api/auth/me/', '/api/reportes/turnos/', '/api/pacientes/',
                     '/api/sesiones/pendientes/'):
            self.assertEqual(client.get(ruta).status_code, 200)

    def test_vencimiento_e_inactivo_conservan_401(self):
        for motivo in ('vencida', 'inactivo'):
            with self.subTest(motivo=motivo):
                client = self.login()
                if motivo == 'vencida':
                    sesion = client.session
                    sesion['_last_activity'] = (timezone.now() - timedelta(minutes=21)).isoformat()
                    sesion.save()
                else:
                    Usuario.objects.filter(pk=self.usuarios['super'].pk).update(activo=False)
                respuesta = self.enviar(client, 'patch', self.url, {},
                                        HTTP_X_CSRFTOKEN=self.token(client))
                self.assertEqual(respuesta.status_code, 401)
                self.assertEqual(respuesta['WWW-Authenticate'], 'Session')
                self.assertNotIn('usuario_id', client.session)

    def test_s2_con_csrf_valido_no_autoriza_paciente_ajeno(self):
        client = self.login('A')
        for metodo in ('patch', 'delete'):
            antes = self.snapshot()
            respuesta = self.enviar(client, metodo, self.url,
                                    {'parentesco_id': self.otro_parentesco.pk},
                                    HTTP_X_CSRFTOKEN=self.token(client))
            self.assertEqual(respuesta.status_code, 403)
            self.assertNotIn(b'CSRF', respuesta.content)
            self.assertEqual(self.snapshot(), antes)


def prueba_sin_csrf(indice):
    def probar(self):
        metodo, ruta, datos, usuario = self.casos()[indice]
        client = self.login(usuario)
        token = self.token(client)
        incorrecto = ('A' if token[0] != 'A' else 'B') + token[1:]
        for modo in ('sin_cabecera', 'malformado', 'distinto', 'sin_cookie'):
            with self.subTest(metodo=metodo, ruta=ruta, modo=modo):
                headers = {}
                if modo == 'malformado':
                    headers['HTTP_X_CSRFTOKEN'] = 'invalido'
                elif modo == 'distinto':
                    headers['HTTP_X_CSRFTOKEN'] = incorrecto
                elif modo == 'sin_cookie':
                    del client.cookies['csrftoken']
                    headers['HTTP_X_CSRFTOKEN'] = token
                self.rechazo_csrf(client, metodo, ruta, datos, **headers)
    return probar


def prueba_con_csrf(indice):
    def probar(self):
        metodo, ruta, datos, usuario = self.casos()[indice]
        client = self.login(usuario)
        sesion = client.session
        actividad = (timezone.now() - timedelta(minutes=1)).isoformat()
        sesion['_last_activity'] = actividad
        sesion.save()
        antes = self.snapshot()
        respuesta = self.enviar(client, metodo, ruta, datos, HTTP_X_CSRFTOKEN=self.token(client))
        self.assertIn(respuesta.status_code, (200, 201, 204), respuesta.content)
        self.assertNotEqual(self.snapshot(), antes)
        self.assertNotEqual(client.session['_last_activity'], actividad)
    return probar


# 22 operaciones, cada una con cuatro rechazos CSRF y una escritura autorizada.
for indice in range(22):
    setattr(SeguridadCSRFTests, f'test_ruta_{indice + 1:02d}_rechazos', prueba_sin_csrf(indice))
    setattr(SeguridadCSRFTests, f'test_ruta_{indice + 1:02d}_autorizada', prueba_con_csrf(indice))


if __name__ == '__main__':
    unittest.main(verbosity=2)
