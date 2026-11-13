"""Pruebas aisladas de acceso y reactivacion de pacientes."""
from datetime import timedelta
import unittest

import test_seguridad_csrf as soporte
from django.utils import timezone

from profesionales.models.asignacion_model import AsignacionProfesional
from pacientes.models.paciente_model import EstadoPaciente


class AccesoPacientesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        soporte.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = soporte.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.estado_inactivo = EstadoPaciente.objects.get(
            estado='Inactivo'
        )

    def paciente_inactivo(self, nombre):
        paciente = self.f.pacientes[nombre]
        paciente.estado = self.estado_inactivo
        paciente.save(update_fields=['estado'])
        AsignacionProfesional.objects.filter(
            paciente=paciente,
            fecha_fin__isnull=True,
        ).update(
            fecha_fin=timezone.localdate() - timedelta(days=1)
        )
        return paciente

    def enviar(self, actor, metodo, ruta, datos=None):
        cliente = self.f.login(actor)
        return getattr(cliente, metodo)(
            ruta,
            datos or {},
            content_type='application/json',
            HTTP_X_CSRFTOKEN=self.f.token(cliente),
        )

    def test_profesional_no_lista_inactivo_ajeno_con_filtros(self):
        paciente_ajeno = self.paciente_inactivo('B')

        respuesta = self.enviar(
            'A',
            'get',
            '/api/pacientes/?buscar=Paciente',
        )

        self.assertEqual(respuesta.status_code, 200, respuesta.content)
        ids = {paciente['id_paciente'] for paciente in respuesta.json()}
        self.assertNotIn(paciente_ajeno.pk, ids)

    def test_profesional_consulta_y_reactiva_su_ultimo_paciente(self):
        paciente_propio = self.paciente_inactivo('A')

        listado = self.enviar(
            'A',
            'get',
            '/api/pacientes/?buscar=Paciente',
        )
        self.assertEqual(listado.status_code, 200, listado.content)
        ids = {paciente['id_paciente'] for paciente in listado.json()}
        self.assertIn(paciente_propio.pk, ids)

        respuesta = self.enviar(
            'A',
            'patch',
            f'/api/pacientes/{paciente_propio.pk}/estado/',
            {'estado': 'Activo'},
        )

        self.assertEqual(respuesta.status_code, 200, respuesta.content)
        self.assertEqual(
            AsignacionProfesional.objects.filter(
                paciente=paciente_propio,
                fecha_fin__isnull=True,
            ).count(),
            1,
        )

    def test_profesional_no_reactiva_paciente_ajeno(self):
        paciente_ajeno = self.paciente_inactivo('B')

        respuesta = self.enviar(
            'A',
            'patch',
            f'/api/pacientes/{paciente_ajeno.pk}/estado/',
            {'estado': 'Activo'},
        )

        self.assertEqual(respuesta.status_code, 400, respuesta.content)
        paciente_ajeno.refresh_from_db()
        self.assertEqual(paciente_ajeno.estado.estado, 'Inactivo')
        self.assertFalse(
            AsignacionProfesional.objects.filter(
                paciente=paciente_ajeno,
                profesional=self.f.profesionales['A'],
                fecha_fin__isnull=True,
            ).exists()
        )

    def test_ultimo_responsable_conserva_acceso_tras_reasignacion(self):
        paciente = self.f.pacientes['A']
        url_reasignacion = (
            f'/api/profesionales/pacientes/{paciente.pk}/reasignar/'
        )

        reasignacion = self.enviar(
            'A',
            'post',
            url_reasignacion,
            {'profesional_id': self.f.profesionales['B'].pk},
        )
        self.assertEqual(reasignacion.status_code, 200, reasignacion.content)

        baja = self.enviar(
            'B',
            'patch',
            f'/api/pacientes/{paciente.pk}/estado/',
            {'estado': 'Inactivo'},
        )
        self.assertEqual(baja.status_code, 200, baja.content)

        listado_a = self.enviar(
            'A',
            'get',
            '/api/pacientes/?buscar=Paciente',
        )
        self.assertEqual(listado_a.status_code, 200, listado_a.content)
        ids_a = {item['id_paciente'] for item in listado_a.json()}
        self.assertNotIn(paciente.pk, ids_a)

        reactivacion_a = self.enviar(
            'A',
            'patch',
            f'/api/pacientes/{paciente.pk}/estado/',
            {'estado': 'Activo'},
        )
        self.assertEqual(reactivacion_a.status_code, 400, reactivacion_a.content)

        listado_b = self.enviar(
            'B',
            'get',
            '/api/pacientes/?buscar=Paciente',
        )
        self.assertEqual(listado_b.status_code, 200, listado_b.content)
        ids_b = {item['id_paciente'] for item in listado_b.json()}
        self.assertIn(paciente.pk, ids_b)

        reactivacion_b = self.enviar(
            'B',
            'patch',
            f'/api/pacientes/{paciente.pk}/estado/',
            {'estado': 'Activo'},
        )
        self.assertEqual(reactivacion_b.status_code, 200, reactivacion_b.content)

    def test_reactivacion_no_duplica_asignacion(self):
        paciente_propio = self.paciente_inactivo('A')
        url = f'/api/pacientes/{paciente_propio.pk}/estado/'

        primera = self.enviar('A', 'patch', url, {'estado': 'Activo'})
        self.assertEqual(primera.status_code, 200, primera.content)
        cantidad = AsignacionProfesional.objects.filter(
            paciente=paciente_propio,
            fecha_fin__isnull=True,
        ).count()

        segunda = self.enviar('A', 'patch', url, {'estado': 'Activo'})

        self.assertEqual(segunda.status_code, 400, segunda.content)
        self.assertEqual(
            AsignacionProfesional.objects.filter(
                paciente=paciente_propio,
                fecha_fin__isnull=True,
            ).count(),
            cantidad,
        )

    def test_administrador_conserva_listado_completo(self):
        paciente_ajeno = self.paciente_inactivo('B')

        respuesta = self.enviar(
            'admin',
            'get',
            '/api/pacientes/?buscar=Paciente',
        )

        self.assertEqual(respuesta.status_code, 200, respuesta.content)
        ids = {paciente['id_paciente'] for paciente in respuesta.json()}
        self.assertIn(paciente_ajeno.pk, ids)

    def test_alta_edicion_y_baja_ordinarias_siguen_funcionando(self):
        paciente_nuevo = {
            'nombre': 'Paciente Nuevo',
            'apellido': 'Ficticio',
            'dni': '40123456',
            'fecha_nacimiento': '2010-01-01',
            'direccion': 'Domicilio ficticio',
            'consentimiento': True,
            'obra_social': self.f.pacientes['B'].obra_social_id,
            'numero_afiliado': 'AF-NUEVO',
            'profesional': self.f.profesionales['A'].pk,
            'tutor': {
                'nombre': 'Tutor Nuevo',
                'apellido': 'Ficticio',
                'dni': '50123456',
                'mail': 'nuevo@example.invalid',
                'domicilio': 'Domicilio ficticio',
                'parentesco_id': self.f.parentesco.pk,
            },
        }
        alta = self.enviar(
            'admin',
            'post',
            '/api/pacientes/',
            paciente_nuevo,
        )
        self.assertEqual(alta.status_code, 201, alta.content)
        paciente_id = alta.json()['id_paciente']

        edicion = self.enviar(
            'A',
            'patch',
            f'/api/pacientes/{paciente_id}/',
            {'direccion': 'Domicilio actualizado'},
        )
        self.assertEqual(edicion.status_code, 200, edicion.content)

        baja = self.enviar(
            'A',
            'patch',
            f'/api/pacientes/{paciente_id}/estado/',
            {'estado': 'Inactivo'},
        )
        self.assertEqual(baja.status_code, 200, baja.content)
