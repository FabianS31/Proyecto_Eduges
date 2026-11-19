"""Reutilización autorizada: datos ficticios y SQLite en memoria."""
import unittest
from unittest.mock import patch
import test_seguridad_csrf as s
import test_altas_etapa4b as altas
from APIs.tutores.services import TutorService


class ReutilizacionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()

    def enviar(self, datos, actor='admin', url='/api/tutores/'):
        c = self.f.login(actor)
        return c.post(url, datos, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c))

    def datos(self):
        return dict(dni=self.f.tutor.dni, paciente_id=self.f.pacientes['A'].pk,
                    parentesco_id=self.f.parentesco.pk, responsable_principal=True)

    def alta(self):
        datos = altas.AltaTests.datos(self)
        datos['tutor'] = dict(dni=self.f.tutor.dni, parentesco_id=self.f.parentesco.pk)
        return datos

    def test_reutiliza_completo_o_incompleto_sin_modificar(self):
        for actor in ('admin', 'super'):
            for vacio in (False, True):
                with self.subTest(actor=actor, vacio=vacio), s.transaction.atomic():
                    if vacio:
                        s.Tutor.objects.filter(pk=self.f.tutor.pk).update(mail='', telefono=None, domicilio='')
                    original = list(s.Tutor.objects.values())
                    datos = dict(self.datos(), nombre='Cambiar', apellido='', mail='invalido',
                                 telefono='X'*100, domicilio='X'*300, responsable_principal=not vacio)
                    r = self.enviar(datos, actor)
                    self.assertEqual(r.status_code, 201, r.content)
                    self.assertEqual(list(s.Tutor.objects.values()), original)
                    self.assertEqual(r.json()['id'], self.f.tutor.pk)
                    s.transaction.set_rollback(True)

    def test_alta_integral_historico_para_roles_autorizados(self):
        for actor in ('B', 'admin', 'super'):
            with self.subTest(actor=actor), s.transaction.atomic():
                s.Tutor.objects.filter(pk=self.f.tutor.pk).update(mail='', telefono='123')
                original = list(s.Tutor.objects.values())
                datos = self.alta()
                if actor != 'B':
                    datos['profesional'] = self.f.profesionales['B'].pk
                r = self.enviar(datos, actor, '/api/pacientes/')
                self.assertEqual(r.status_code, 201, r.content)
                self.assertEqual(list(s.Tutor.objects.values()), original)
                self.assertTrue(s.PacienteTutor.objects.filter(paciente_id=r.json()['id_paciente'],
                    tutor=self.f.tutor, activo=True, responsable_principal=True).exists())
                s.transaction.set_rollback(True)

    def test_nuevo_mantiene_validaciones(self):
        for url in ('/api/tutores/', '/api/pacientes/'):
            datos = dict(self.datos(), dni='20123456') if url.endswith('tutores/') else self.alta()
            if url.endswith('pacientes/'):
                datos['tutor']['dni'] = '20123456'
            antes = self.f.snapshot()
            r = self.enviar(datos, 'B', url)
            self.assertEqual(r.status_code, 400, r.content)
            self.assertEqual(self.f.snapshot(), antes)

    def test_ajeno_incompleto_no_revela_existencia(self):
        datos = self.datos()
        antes = self.f.snapshot()
        ajeno = self.enviar(datos, 'A')
        inexistente = self.enviar(dict(datos, dni='20123456'), 'A')
        self.assertEqual(ajeno.status_code, 400)
        self.assertEqual(ajeno.json(), inexistente.json())
        self.assertEqual(self.f.snapshot(), antes)
        c = self.f.login('A')
        self.assertEqual(c.get('/api/tutores/', {'q': self.f.tutor.dni}).json(), [])
        self.assertEqual(c.get(f'/api/tutores/{self.f.tutor.pk}/').status_code, 403)

    def test_ajeno_completo_rechazado_sin_datos_personales(self):
        datos = dict(self.datos(), nombre='Ficticio', apellido='Ficticio', mail='ficticio@example.com',
                     domicilio='Ficticio', telefono='123')
        antes = self.f.snapshot()
        r = self.enviar(datos, 'A')
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(set(r.json()), {'detail'})
        self.assertEqual(self.f.snapshot(), antes)

    def test_relacion_existente_y_reactivacion(self):
        datos = dict(self.datos(), paciente_id=self.f.pacientes['B'].pk, responsable_principal=False)
        antes = self.f.snapshot()
        self.assertEqual(self.enviar(datos, 'B').status_code, 400)
        self.assertEqual(self.f.snapshot(), antes)
        s.PacienteTutor.objects.filter(pk=self.f.relacion.pk).update(activo=False)
        self.assertEqual(self.enviar(datos).status_code, 201)
        self.f.relacion.refresh_from_db()
        self.assertTrue(self.f.relacion.activo)
        self.assertEqual(s.PacienteTutor.objects.filter(tutor=self.f.tutor,
            paciente=self.f.pacientes['B']).count(), 1)

    def test_principal_de_otro_paciente_y_no_dos_principales(self):
        s.PacienteTutor.objects.filter(pk=self.f.principal.pk).update(responsable_principal=False)
        s.PacienteTutor.objects.filter(pk=self.f.relacion.pk).update(responsable_principal=True)
        self.assertEqual(self.enviar(self.datos()).status_code, 201)
        self.assertEqual(s.PacienteTutor.objects.filter(tutor=self.f.tutor,
            responsable_principal=True, activo=True).count(), 2)
        antes = self.f.snapshot()
        self.assertEqual(self.enviar(self.datos()).status_code, 400)
        self.assertEqual(self.f.snapshot(), antes)

    def test_revocacion_de_acceso_se_revalida(self):
        original = TutorService.crear_tutor
        def revocar(datos_tutor, datos_relacion, usuario):
            s.PacienteTutor.objects.filter(pk=self.f.relacion.pk).update(activo=False)
            return original(datos_tutor, datos_relacion, usuario)
        antes = self.f.snapshot()
        with patch.object(TutorService, 'crear_tutor', side_effect=revocar):
            r = self.enviar(self.alta(), 'B', '/api/pacientes/')
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(self.f.snapshot(), antes)

    def test_identidad_cambiada_no_crea_tutor_incompleto(self):
        original = TutorService.crear_tutor
        def cambiar(datos_tutor, datos_relacion, usuario):
            s.Tutor.objects.filter(pk=self.f.tutor.pk).update(dni='20888888')
            return original(datos_tutor, datos_relacion, usuario)
        antes = self.f.snapshot()
        with patch.object(TutorService, 'crear_tutor', side_effect=cambiar):
            r = self.enviar(self.alta(), 'B', '/api/pacientes/')
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.f.snapshot(), antes)

    def test_fallo_vinculo_revierte_alta_integral(self):
        antes = self.f.snapshot()
        with patch.object(s.PacienteTutor, 'save', side_effect=RuntimeError('Fallo ficticio')):
            with self.assertRaises(RuntimeError):
                self.enviar(self.alta(), 'B', '/api/pacientes/')
        self.assertEqual(self.f.snapshot(), antes)

    def test_sin_permiso(self):
        for actor in ('otro', 'sin_vinculo'):
            antes = self.f.snapshot()
            self.assertIn(self.enviar(self.datos(), actor).status_code, (400, 403))
            self.assertEqual(self.f.snapshot(), antes)


if __name__ == '__main__':
    unittest.main()
