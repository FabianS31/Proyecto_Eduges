"""S2: rutas reales, datos ficticios y SQLite en memoria, sin migraciones.

Ejecutar desde la raíz:
    venv/Scripts/python.exe -B tests/test_seguridad_relaciones_tutores.py
No importa config.settings ni carga .env. La autenticación se simula;
los permisos, consultas, serializers y servicios son los de producción.
"""
from datetime import date
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'SistemaEduGes/Backend'))

from django.conf import settings

settings.configure(
    SECRET_KEY='clave-ficticia-exclusiva-de-pruebas-aisladas',
    INSTALLED_APPS=['usuarios', 'profesionales', 'pacientes', 'turnos'],
    DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}},
    ROOT_URLCONF='config.urls',
    REST_FRAMEWORK={
        'UNAUTHENTICATED_USER': None,
        'DEFAULT_AUTHENTICATION_CLASSES': [
            'APIs.autenticacion.autenticacion.UsuarioSessionAuthentication',
        ],
    },
    USE_TZ=True,
)

import django
django.setup()

from django.apps import apps
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext
from django.urls import resolve, get_resolver, URLResolver
from rest_framework.test import APIRequestFactory, force_authenticate
from usuarios.models.usuario_model import Usuario
from usuarios.models.rol_model import Rol
from profesionales.models.profesional_model import Profesional, Especialidad
from profesionales.models.estados_profesionales_model import EstadoProfesional
from profesionales.models.asignacion_model import AsignacionProfesional
from pacientes.models import Paciente, Tutor, PacienteTutor, Parentesco
from pacientes.models.paciente_model import EstadoPaciente
from pacientes.models.obra_social_model import ObraSocial, EstadoObraSocial, TipoObraSocial
from APIs.tutores.views import RelacionTutorDetailView, TutorListCreateView, TutorDetailView


class SeguridadRelacionesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.modelos = list(apps.get_models())
        # Crear tablas unmanaged solamente en :memory:, sin ejecutar migraciones.
        with connection.schema_editor() as schema:
            for modelo in cls.modelos:
                schema.create_model(modelo)

    def setUp(self):
        self.atomic = transaction.atomic()
        self.atomic.__enter__()
        self.addCleanup(self.rollback)
        self.factory = APIRequestFactory()
        self.roles = {r: Rol.objects.create(rol=r) for r in (
            'Profesional', 'Administrador', 'SuperAdministrador', 'Otro',
        )}
        self.usuarios = {}
        for nombre, rol in (
            ('A', 'Profesional'), ('B', 'Profesional'), ('sin_vinculo', 'Profesional'),
            ('admin', 'Administrador'), ('super', 'SuperAdministrador'), ('otro', 'Otro'),
        ):
            self.usuarios[nombre] = Usuario.objects.create(
                usuario=f'ficticio_{nombre}', password='!sin-password-utilizable',
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
            nombre='Tutor', apellido='Ficticio', dni='20999999',
            mail='ficticio@example.invalid', domicilio='Domicilio ficticio',
        )
        self.relacion = PacienteTutor.objects.create(
            tutor=self.tutor, paciente=self.pacientes['B'], parentesco=self.parentesco,
            responsable_principal=False, activo=True,
        )
        self.url = f'/api/tutores/relaciones/{self.relacion.pk}/'

    def rollback(self):
        transaction.set_rollback(True)
        self.atomic.__exit__(None, None, None)

    def snapshot(self):
        return {m._meta.label: list(m.objects.order_by('pk').values()) for m in self.modelos}

    def solicitar(self, metodo, usuario='A', datos=None, url=None):
        ruta = url or self.url
        request = getattr(self.factory, metodo)(ruta, datos or {}, format='json')
        request.session = {}
        if usuario is not None:
            force_authenticate(request, user=self.usuarios[usuario])
        match = resolve(ruta)
        antes = self.snapshot()
        with CaptureQueriesContext(connection) as consultas:
            respuesta = match.func(request, *match.args, **match.kwargs)
        # Todos los rechazos se verifican sobre todas las tablas, no solo activo.
        if respuesta.status_code >= 400:
            self.assertEqual(self.snapshot(), antes)
            escrituras = [q['sql'] for q in consultas if q['sql'].lstrip().split()[0].upper()
                          in ('INSERT', 'UPDATE', 'DELETE', 'REPLACE')]
            self.assertEqual(escrituras, [])
        return respuesta

    def test_patch_ajeno_devuelve_403_sin_escrituras(self):
        respuesta = self.solicitar('patch', datos={'parentesco_id': self.otro_parentesco.pk})
        self.assertEqual(respuesta.status_code, 403, respuesta.data)

    def test_delete_ajeno_devuelve_403_sin_escrituras(self):
        self.assertEqual(self.solicitar('delete').status_code, 403)

    def test_patch_y_delete_propios_y_administrativos(self):
        for usuario in ('B', 'admin', 'super'):
            with self.subTest(usuario=usuario):
                PacienteTutor.objects.filter(pk=self.relacion.pk).update(
                    activo=True, parentesco=self.parentesco,
                )
                respuesta = self.solicitar('patch', usuario, {'parentesco_id': self.otro_parentesco.pk})
                self.assertEqual(respuesta.status_code, 200, respuesta.data)
                self.relacion.refresh_from_db()
                self.assertEqual(self.relacion.parentesco_id, self.otro_parentesco.pk)
                self.assertEqual(self.solicitar('delete', usuario).status_code, 200)
                self.relacion.refresh_from_db()
                self.assertFalse(self.relacion.activo)

    def test_asignacion_finalizada_no_autoriza(self):
        AsignacionProfesional.objects.create(
            paciente=self.pacientes['B'], profesional=self.profesionales['A'],
            fecha_inicio=date(2025, 1, 1), fecha_fin=date(2025, 12, 31),
        )
        for metodo in ('patch', 'delete'):
            self.assertEqual(self.solicitar(metodo).status_code, 403)

    def test_profesional_sin_vinculo_no_autoriza(self):
        for metodo in ('patch', 'delete'):
            self.assertEqual(self.solicitar(metodo, 'sin_vinculo').status_code, 403)

    def test_sin_sesion_y_rol_no_permitido(self):
        for metodo in ('patch', 'delete'):
            self.assertEqual(self.solicitar(metodo, None).status_code, 401)
            self.assertEqual(self.solicitar(metodo, 'otro').status_code, 403)

    def test_paciente_del_cuerpo_no_puede_suplantar_al_guardado(self):
        for metodo in ('patch', 'delete'):
            respuesta = self.solicitar(metodo, datos={
                'paciente_id': self.pacientes['A'].pk,
                'parentesco_id': self.otro_parentesco.pk,
            })
            self.assertEqual(respuesta.status_code, 403)

    def test_compartir_tutor_no_autoriza_relacion_de_otro_paciente(self):
        PacienteTutor.objects.create(
            tutor=self.tutor, paciente=self.pacientes['A'], parentesco=self.parentesco,
            responsable_principal=False,
        )
        for metodo in ('patch', 'delete'):
            self.assertEqual(self.solicitar(metodo).status_code, 403)

    def test_reactivacion_ajena_rechazada_y_propia_permitida(self):
        PacienteTutor.objects.filter(pk=self.relacion.pk).update(activo=False)
        self.assertEqual(self.solicitar('patch', datos={'activo': True}).status_code, 403)
        self.assertEqual(self.solicitar('patch', 'B', {'activo': True}).status_code, 200)
        self.relacion.refresh_from_db()
        self.assertTrue(self.relacion.activo)

    def test_reglas_existentes_siguen_vigentes(self):
        for usuario in ('B', 'admin', 'super'):
            with self.subTest(usuario=usuario):
                self.assertEqual(self.solicitar('patch', usuario, {'activo': False}).status_code, 400)
                self.assertEqual(self.solicitar('patch', usuario, {
                    'paciente_id': self.pacientes['A'].pk,
                }).status_code, 400)

    def test_post_alternativo_no_crea_ni_reactiva_relacion_ajena(self):
        for activo in (True, False):
            PacienteTutor.objects.filter(pk=self.relacion.pk).update(activo=activo)
            respuesta = self.solicitar('post', datos={
                'nombre': 'Intento de cambio', 'apellido': 'Ficticio', 'dni': self.tutor.dni,
                'mail': 'otro@example.invalid', 'domicilio': 'Otro ficticio',
                'paciente_id': self.pacientes['B'].pk,
                'parentesco_id': self.otro_parentesco.pk,
            }, url='/api/tutores/')
            self.assertEqual(respuesta.status_code, 403, respuesta.data)

    def test_detalle_tutor_no_permite_editar_relacion_anidada(self):
        # Incluso con acceso al tutor compartido, este endpoint solo edita al tutor.
        PacienteTutor.objects.create(
            tutor=self.tutor, paciente=self.pacientes['A'], parentesco=self.parentesco,
            responsable_principal=False,
        )
        antes = list(PacienteTutor.objects.order_by('pk').values())
        respuesta = self.solicitar('patch', datos={
            'relaciones': [{'id': self.relacion.pk, 'activo': False}],
            'paciente_id': self.pacientes['B'].pk, 'activo': False,
        }, url=f'/api/tutores/{self.tutor.pk}/')
        self.assertEqual(respuesta.status_code, 200, respuesta.data)
        self.assertEqual(list(PacienteTutor.objects.order_by('pk').values()), antes)

    def test_metodos_alternativos_no_habilitados_y_relacion_inexistente(self):
        for metodo in ('put', 'post'):
            self.assertEqual(self.solicitar(metodo).status_code, 405)
        for metodo in ('patch', 'delete'):
            self.assertEqual(self.solicitar(metodo, url='/api/tutores/relaciones/999999/').status_code, 404)

    def test_inventario_de_rutas_tutores(self):
        def recorrer(patrones, prefijo=''):
            for patron in patrones:
                ruta = prefijo + str(patron.pattern)
                if isinstance(patron, URLResolver):
                    yield from recorrer(patron.url_patterns, ruta)
                else:
                    yield ruta, getattr(patron.callback, 'view_class', None)
        rutas = [(ruta, vista) for ruta, vista in recorrer(get_resolver().url_patterns)
                 if vista in (RelacionTutorDetailView, TutorListCreateView, TutorDetailView)]
        self.assertCountEqual(rutas, [
            ('api/tutores/', TutorListCreateView),
            ('api/tutores/<int:pk>/', TutorDetailView),
            ('api/tutores/relaciones/<int:pk>/', RelacionTutorDetailView),
        ])


if __name__ == '__main__':
    unittest.main(verbosity=2)
