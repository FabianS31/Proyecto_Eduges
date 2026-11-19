"""Estado inicial: API real, datos ficticios y SQLite exclusivamente en memoria."""
import unittest
from unittest.mock import patch
import test_seguridad_csrf as s
import test_altas_etapa4b as altas
from pacientes.models.paciente_model import EstadoPaciente


class EstadoInicialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()

    datos = altas.AltaTests.datos
    post = altas.AltaTests.post

    def test_altas_roles_estado_omitido_y_explicito(self):
        for actor in ('A', 'admin', 'super'):
            for explicito in (False, True):
                with self.subTest(actor=actor, explicito=explicito), s.transaction.atomic():
                    datos = self.datos()
                    if actor != 'A':
                        datos['profesional'] = self.f.profesionales['A'].pk
                    if explicito:
                        datos['estado'] = EstadoPaciente.objects.get(estado='Activo').pk
                    r = self.post(datos, actor)
                    self.assertEqual(r.status_code, 201, r.content)
                    paciente = s.Paciente.objects.get(pk=r.json()['id_paciente'])
                    self.assertEqual(paciente.estado.estado, 'Activo')
                    self.assertEqual(s.AsignacionProfesional.objects.filter(
                        paciente=paciente, profesional=self.f.profesionales['A'], fecha_fin__isnull=True).count(), 1)
                    self.assertEqual(s.PacienteTutor.objects.filter(
                        paciente=paciente, activo=True, responsable_principal=True).count(), 1)
                    s.transaction.set_rollback(True)

    def test_estados_rechazados_sin_escrituras(self):
        inactivo = EstadoPaciente.objects.get_or_create(estado='Inactivo')[0]
        otro = EstadoPaciente.objects.create(estado='Otro ficticio')
        for estado in (inactivo.pk, otro.pk, 99999, 'invalido', None, -1):
            datos = dict(self.datos(), estado=estado)
            antes = self.f.snapshot()
            r = self.post(datos)
            self.assertEqual(r.status_code, 400, r.content)
            self.assertIn('estado', r.json())
            self.assertEqual(self.f.snapshot(), antes)

    def test_activo_ausente_error_catalogo(self):
        EstadoPaciente.objects.filter(estado='Activo').update(estado='Otro ficticio')
        antes = self.f.snapshot()
        r = self.post(self.datos())
        self.assertEqual(r.status_code, 503, r.content)
        self.assertEqual(r.json()['codigo'], 'configuracion_catalogo')
        self.assertEqual(self.f.snapshot(), antes)

    def test_activo_no_depende_de_id_uno(self):
        EstadoPaciente.objects.filter(estado='Activo').update(estado='Anterior ficticio')
        activo = EstadoPaciente.objects.create(estado='Activo')
        self.assertNotEqual(activo.pk, 1)
        r = self.post(self.datos())
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(s.Paciente.objects.get(pk=r.json()['id_paciente']).estado_id, activo.pk)

    def test_reutiliza_tutor_principal(self):
        datos = self.datos()
        datos['tutor']['dni'] = self.f.tutor.dni
        antes = s.Tutor.objects.count()
        r = self.post(datos, 'B')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(s.Tutor.objects.count(), antes)
        self.assertTrue(s.PacienteTutor.objects.filter(paciente_id=r.json()['id_paciente'],
            tutor=self.f.tutor, responsable_principal=True, activo=True).exists())

    def test_permisos_conservados(self):
        for actor in ('otro', 'sin_vinculo'):
            antes = self.f.snapshot()
            self.assertEqual(self.post(self.datos(), actor).status_code, 403)
            self.assertEqual(self.f.snapshot(), antes)
        self.assertEqual(s.Client().post('/api/pacientes/', self.datos(),
                                        content_type='application/json').status_code, 401)

    def test_edicion_historico_inactivo(self):
        paciente = self.f.pacientes['A']
        estado = EstadoPaciente.objects.get_or_create(estado='Inactivo')[0]
        s.Paciente.objects.filter(pk=paciente.pk).update(estado=estado)
        c = self.f.login('A')
        r = c.patch(f'/api/pacientes/{paciente.pk}/', {'nombre': 'Nombre Ficticio'},
                    content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c))
        self.assertEqual(r.status_code, 200, r.content)
        paciente.refresh_from_db()
        self.assertEqual(paciente.estado_id, estado.pk)

    def test_error_tutor_revierte_alta_activa(self):
        antes = self.f.snapshot()
        with patch.object(s.PacienteTutor, 'save', side_effect=RuntimeError('Fallo ficticio')):
            with self.assertRaises(RuntimeError):
                self.post(self.datos())
        self.assertEqual(self.f.snapshot(), antes)


if __name__ == '__main__':
    unittest.main()
