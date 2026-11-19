"""Catálogos: SQLite en memoria y NULL simulados sin cambiar modelos físicos."""
import sqlite3
import unittest
from unittest.mock import patch

import test_seguridad_csrf as s
import test_altas_etapa4b as altas
from django.db import IntegrityError
from rest_framework.exceptions import PermissionDenied
from APIs.obras_sociales.serializers.obra_social_serializer import ObraSocialSerializer
from APIs.pacientes.serializers.paciente_serializer import PacienteSerializer
from APIs.profesionales.permisos import validar_edicion_cuenta
from APIs.servicios.errores_catalogo import CatalogoNoDisponible
from APIs.tutores.serializers.tutor_entrada_serializer import TutorEntradaSerializer
from pacientes.models.obra_social_model import ObraSocial, EstadoObraSocial, TipoObraSocial


class CatalogosTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.c = self.f.login('super')

    def enviar(self, datos, metodo='post', url='/api/obras-sociales/'):
        return getattr(self.c, metodo)(url, datos, content_type='application/json',
                                      HTTP_X_CSRFTOKEN=self.f.token(self.c))

    def test_creacion_predeterminados_validos(self):
        r = self.enviar({'nombre': 'Nueva ficticia'})
        self.assertEqual(r.status_code, 201, r.content)
        obj = ObraSocial.objects.get(nombre='Nueva ficticia')
        self.assertEqual(obj.tipo_id, TipoObraSocial.objects.get().pk)
        self.assertEqual(obj.estado_id, EstadoObraSocial.objects.get(descripcion='Activa').pk)

    def test_tipo_vacio_sin_escrituras(self):
        antes = self.f.snapshot()
        with patch.object(TipoObraSocial.objects, 'all', return_value=[]):
            r = self.enviar({'nombre': 'Nueva ficticia'})
        self.assertEqual(r.status_code, 503, r.content)
        self.assertEqual(r.json()['codigo'], 'configuracion_catalogo')
        self.assertEqual(self.f.snapshot(), antes)

    def test_estado_predeterminado_ausente(self):
        antes = self.f.snapshot()
        with patch.object(EstadoObraSocial.objects, 'all', return_value=[]):
            r = self.enviar({'nombre': 'Nueva ficticia'})
        self.assertEqual(r.status_code, 503, r.content)
        self.assertEqual(self.f.snapshot(), antes)

    def test_estado_uno_no_activa_no_se_sustituye(self):
        for descripcion in ('Inactiva', 'Otro estado'):
            EstadoObraSocial.objects.filter(pk=1).update(descripcion=descripcion)
            antes = self.f.snapshot()
            r = self.enviar({'nombre': 'Nueva ficticia'})
            self.assertEqual(r.status_code, 503, r.content)
            self.assertEqual(self.f.snapshot(), antes)

    def test_estado_null_predeterminado(self):
        estado = EstadoObraSocial.objects.get(pk=1)
        estado.descripcion = None
        antes = self.f.snapshot()
        with patch.object(EstadoObraSocial.objects, 'all', return_value=[estado]):
            r = self.enviar({'nombre': 'Nueva ficticia'})
        self.assertEqual(r.status_code, 503, r.content)
        self.assertEqual(r.json()['codigo'], 'configuracion_catalogo')
        self.assertEqual(self.f.snapshot(), antes)

    def test_estado_null_explicito_y_edicion(self):
        obra = self.f.pacientes['A'].obra_social
        obra.estado.descripcion = None
        for serializer, attrs in ((ObraSocialSerializer(), {'tipo': obra.tipo, 'estado': obra.estado}),
                                  (ObraSocialSerializer(obra), {})):
            with self.assertRaises(CatalogoNoDisponible):
                serializer.validate(attrs)

    def test_estado_inactivo_explicito_error_usuario(self):
        estado = EstadoObraSocial.objects.create(descripcion='Inactiva')
        r = self.enviar({'nombre': 'Nueva ficticia', 'estado_id': estado.pk})
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn('estado_id', r.json())

    def test_ids_invalidos_error_usuario(self):
        for campo in ('estado_id', 'tipo_id'):
            r = self.enviar({'nombre': 'Nueva ficticia', campo: 99999})
            self.assertEqual(r.status_code, 400, r.content)
            self.assertIn(campo, r.json())

    def test_catalogos_explicitos_no_dependen_del_default(self):
        obra = self.f.pacientes['A'].obra_social
        with patch.object(TipoObraSocial.objects, 'first', side_effect=AssertionError), \
             patch.object(EstadoObraSocial.objects, 'filter', side_effect=AssertionError):
            r = self.enviar({'nombre': 'Nueva ficticia', 'tipo_id': obra.tipo_id,
                             'estado_id': obra.estado_id})
        self.assertEqual(r.status_code, 201, r.content)

    def test_paciente_estado_null_sin_alta_parcial(self):
        original = EstadoObraSocial.from_db

        def cargar(cls, *args, **kwargs):
            obj = original(*args, **kwargs)
            obj.descripcion = None
            return obj

        datos = altas.AltaTests.datos(self)
        datos['profesional'] = self.f.profesionales['A'].pk
        antes = self.f.snapshot()
        with patch.object(EstadoObraSocial, 'from_db', classmethod(cargar)):
            r = self.enviar(datos, url='/api/pacientes/')
        self.assertEqual(r.status_code, 503, r.content)
        self.assertEqual(self.f.snapshot(), antes)

    def test_paciente_estado_valido(self):
        obra = self.f.pacientes['A'].obra_social
        self.assertIs(PacienteSerializer().validate_obra_social(obra), obra)

    def test_estado_null_lectura_y_patch_historico_paciente(self):
        original = EstadoObraSocial.from_db

        def cargar(cls, *args, **kwargs):
            obj = original(*args, **kwargs)
            obj.descripcion = None
            return obj

        paciente = self.f.pacientes['A']
        self.c = self.f.login('A')
        with patch.object(EstadoObraSocial, 'from_db', classmethod(cargar)):
            r = self.c.get('/api/obras-sociales/')
            self.assertEqual(r.status_code, 200, r.content)
            self.assertIsNone(r.json()[0]['estado']['nombre'])
            r = self.enviar({'nombre': 'Nombre Ficticio', 'obra_social': paciente.obra_social_id},
                            'patch', f'/api/pacientes/{paciente.pk}/')
            self.assertEqual(r.status_code, 200, r.content)
            self.assertIsNone(r.json()['obra_social']['estado']['descripcion'])

    def test_rol_null_api_sin_escritura(self):
        from usuarios.models.rol_model import Permiso, RolPermiso
        permiso = Permiso.objects.create(permiso='profesionales.edit', descripcion='Ficticio')
        RolPermiso.objects.create(rol=self.f.roles['Administrador'], permiso=permiso)
        self.c = self.f.login('admin')
        original = s.Profesional.from_db

        def cargar(cls, *args, **kwargs):
            obj = original(*args, **kwargs)
            obj.rol = None
            return obj

        antes = self.f.snapshot()
        with patch.object(s.Profesional, 'from_db', classmethod(cargar)):
            r = self.enviar({'nombre': 'Nombre Ficticio'}, 'patch',
                            f'/api/profesionales/{self.f.profesionales["B"].pk}/')
        self.assertEqual(r.status_code, 503, r.content)
        self.assertEqual(self.f.snapshot(), antes)

    def test_integridad_rollback_y_clasificacion(self):
        for metodo in ('post', 'patch'):
            for duplicado in (True, False):
                causa = sqlite3.IntegrityError(
                    f'UNIQUE constraint failed: {ObraSocial._meta.db_table}.{ObraSocial._meta.get_field("nombre").column}'
                    if duplicado else 'NOT NULL constraint failed: ficticio')
                causa.sqlite_errorcode = 2067 if duplicado else 1299
                error = IntegrityError('Fallo ficticio')
                error.__cause__ = causa
                obra = self.f.pacientes['A'].obra_social
                antes = self.f.snapshot()

                def guardar(*args, **kwargs):
                    ObraSocial.objects.filter(pk=obra.pk).update(contacto='Escritura a revertir')
                    raise error

                url = '/api/obras-sociales/' + (f'{obra.pk}/' if metodo == 'patch' else '')
                with patch.object(ObraSocialSerializer, 'save', side_effect=guardar), \
                     patch('APIs.obras_sociales.views.logger.exception'):
                    r = self.enviar({'nombre': 'Nueva ficticia'}, metodo, url)
                self.assertEqual(r.status_code, 409 if duplicado else 500, r.content)
                self.assertEqual(r.json()['codigo'], 'obra_social_duplicada' if duplicado else 'error_integridad')
                self.assertEqual(self.f.snapshot(), antes)

    def test_permisos_antes_de_catalogos(self):
        self.c = self.f.login('A')
        antes = self.f.snapshot()
        with patch.object(TipoObraSocial.objects, 'first', side_effect=AssertionError):
            self.assertEqual(self.enviar({'nombre': 'Nueva ficticia'}).status_code, 403)
        self.assertEqual(self.f.snapshot(), antes)

    def test_rol_null_no_concede_permiso(self):
        profesional = self.f.profesionales['B']
        profesional.rol = None
        for actor in ('A', 'admin'):
            with self.assertRaises(CatalogoNoDisponible):
                validar_edicion_cuenta(self.f.usuarios[actor], profesional)
        # La cuenta técnica ya estaba autorizada; no asignar ningún rol.
        validar_edicion_cuenta(self.f.usuarios['super'], profesional)
        self.assertIsNone(profesional.rol_id)

    def test_proteccion_roles_validos(self):
        profesional = self.f.profesionales['B']
        profesional.rol = self.f.roles['SuperAdministrador']
        with self.assertRaises(PermissionDenied):
            validar_edicion_cuenta(self.f.usuarios['admin'], profesional)

    def test_dni_tutor_null_omitido_no_se_altera(self):
        tutor = self.f.tutor
        tutor.dni = None
        serializer = TutorEntradaSerializer(tutor, data={'nombre': 'Nombre Ficticio'}, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertNotIn('dni', serializer.validated_data)
        self.assertIsNone(tutor.dni)


if __name__ == '__main__':
    unittest.main()
