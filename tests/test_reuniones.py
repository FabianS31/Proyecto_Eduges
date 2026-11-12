"""Contrato existente de sesiones; solo SQLite en memoria y usuarios ficticios."""
import unittest
import test_seguridad_csrf as s


class ReunionesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()

    def test_guardado_consulta_privacidad_y_duplicado(self):
        c = self.f.login('B')
        texto = 'Reunión con padre/madre o tutor\nParticipante y vínculo: Persona ficticia, madre\nModalidad: virtual\nTemas tratados: seguimiento\nAcuerdos y seguimiento: próximo encuentro'
        datos = dict(turno_id=self.f.turno.pk, trabajo_sesion=texto,
                     diagnostico='No se realizó evaluación diagnóstica durante este encuentro', nota_sesion='Nota privada ficticia')
        r = c.post('/api/sesiones/', datos, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c))
        self.assertEqual(r.status_code, 201, r.content)
        url = f'/api/sesiones/{self.f.turno.pk}/'
        r = c.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['trabajo_sesion'], texto)
        self.assertEqual(r.json()['diagnostico'], datos['diagnostico'])
        self.assertEqual(r.json()['nota_sesion'], datos['nota_sesion'])
        admin = self.f.login('admin').get(url)
        self.assertEqual(admin.status_code, 200)
        self.assertNotIn('trabajo_sesion', admin.json())
        self.assertNotIn('nota_sesion', admin.json())
        self.assertEqual(self.f.login('A').get(url).status_code, 403)
        antes = self.f.snapshot()
        self.assertEqual(c.post('/api/sesiones/', datos, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c)).status_code, 400)
        self.assertEqual(self.f.snapshot(), antes)

    def test_diagnostico_vacio_no_guarda(self):
        c = self.f.login('B')
        antes = self.f.snapshot()
        r = c.post('/api/sesiones/', dict(turno_id=self.f.turno.pk, trabajo_sesion='Reunión', diagnostico=''),
                   content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.f.snapshot(), antes)


if __name__ == '__main__':
    unittest.main()
