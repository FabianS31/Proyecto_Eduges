"""Catalogo y consumidores reales sobre SQLite en memoria, sin red ni .env."""
import unittest
import test_seguridad_csrf as s


class ParentescosTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.nuevo = s.Parentesco.objects.create(pk=84, descripcion='Catalogo real')
        self.url = '/api/tutores/parentescos/'

    def test_roles_contrato_y_get_sin_csrf(self):
        antes = self.f.snapshot()
        for actor in ('A', 'B', 'admin', 'super'):
            r = self.f.login(actor).get(self.url)
            self.assertEqual(r.status_code, 200)
            self.assertIn({'id': 84, 'nombre': 'Catalogo real'}, r.json())
            self.assertTrue(all(set(x) == {'id', 'nombre'} for x in r.json()))
        self.assertEqual(self.f.login('otro').get(self.url).status_code, 403)
        self.assertEqual(s.Client().get(self.url).status_code, 401)
        self.assertEqual(self.f.snapshot(), antes)

    def test_solo_lectura_y_csrf(self):
        c = self.f.login('admin')
        antes = self.f.snapshot()
        self.assertEqual(c.post(self.url, {}).status_code, 403)
        self.assertEqual(c.post(self.url, {}, HTTP_X_CSRFTOKEN=self.f.token(c)).status_code, 405)
        self.assertEqual(self.f.snapshot(), antes)

    def test_catalogo_vacio(self):
        s.PacienteTutor.objects.all().delete()
        s.Parentesco.objects.all().delete()
        self.assertEqual(self.f.login('A').get(self.url).json(), [])

    def test_alta_y_vinculacion_con_id_real(self):
        c = self.f.login('A')
        pk = next(x['id'] for x in c.get(self.url).json() if x['nombre'] == 'Catalogo real')
        tutor = dict(nombre='Nuevo', apellido='Tutor', dni='20123456',
                     mail='ficticio@example.com', telefono='123', domicilio='Prueba', parentesco_id=pk)
        datos = dict(nombre='Nuevo', apellido='Paciente', dni='40123456',
                     fecha_nacimiento='2010-01-01', direccion='Prueba', consentimiento=True,
                     obra_social=self.f.pacientes['A'].obra_social_id, numero_afiliado='AF', tutor=tutor)
        r = c.post('/api/pacientes/', datos, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(s.PacienteTutor.objects.filter(paciente_id=r.json()['id_paciente'], parentesco_id=84).exists())
        tutor['paciente_id'] = self.f.pacientes['A'].pk
        r = c.post('/api/tutores/', tutor, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(s.PacienteTutor.objects.filter(paciente_id=tutor['paciente_id'], parentesco_id=84).exists())
        antes = self.f.snapshot()
        tutor['parentesco_id'] = 99999
        r = c.post('/api/tutores/', tutor, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c))
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.f.snapshot(), antes)


if __name__ == '__main__':
    unittest.main()
