"""Alta atomica: rutas reales y SQLite en memoria; sin configuracion externa."""
import unittest
from unittest.mock import patch
import test_seguridad_csrf as s


class AltaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()

    def datos(self):
        return dict(nombre='Nuevo', apellido='Paciente', dni='40123456',
                    fecha_nacimiento='2010-01-01', direccion='Prueba', consentimiento=True,
                    obra_social=self.f.pacientes['A'].obra_social_id, numero_afiliado='AF',
                    tutor=dict(nombre='Nuevo', apellido='Tutor', dni='20123456',
                               mail='ficticio@example.com', telefono='123', domicilio='Prueba',
                               parentesco_id=self.f.parentesco.pk))

    def post(self, datos, actor='A'):
        c = self.f.login(actor)
        return c.post('/api/pacientes/', datos, content_type='application/json',
                      HTTP_X_CSRFTOKEN=self.f.token(c))

    def comprobar(self, actor='A', dni='40123456'):
        return self.f.login(actor).get('/api/pacientes/alta/resultado/', {'dni': dni})

    def test_alta_completa_y_consulta_autorizada(self):
        r = self.post(self.datos())
        self.assertEqual(r.status_code, 201, r.content)
        pk = r.json()['id_paciente']
        self.assertTrue(s.AsignacionProfesional.objects.filter(paciente_id=pk,
            profesional=self.f.profesionales['A'], fecha_fin__isnull=True).exists())
        self.assertEqual(s.PacienteTutor.objects.filter(paciente_id=pk, activo=True,
            responsable_principal=True).count(), 1)
        self.assertEqual(self.comprobar().json()['paciente']['id_paciente'], pk)
        self.assertEqual(self.comprobar('B').json(), {'paciente': None})
        self.assertEqual(self.comprobar('admin').json()['paciente']['id_paciente'], pk)
        s.AsignacionProfesional.objects.filter(paciente_id=pk).update(fecha_fin=s.date.today())
        self.assertEqual(self.comprobar().json(), {'paciente': None})

    def test_fallos_intermedios_revierten_todas_las_tablas(self):
        for modelo in (s.AsignacionProfesional, s.Tutor, s.PacienteTutor):
            antes = self.f.snapshot()
            with patch.object(modelo, 'save', side_effect=RuntimeError('fallo simulado')):
                with self.assertRaises(RuntimeError):
                    self.post(self.datos())
            self.assertEqual(self.f.snapshot(), antes)

    def test_tutor_existente_autorizado_no_se_sobrescribe(self):
        datos = self.datos()
        datos['tutor']['dni'] = self.f.tutor.dni
        original = s.Tutor.objects.get(pk=self.f.tutor.pk).__dict__.copy()
        r = self.post(datos, 'B')
        self.assertEqual(r.status_code, 201, r.content)
        self.f.tutor.refresh_from_db()
        for campo in ('nombre', 'apellido', 'telefono', 'domicilio', 'mail'):
            self.assertEqual(getattr(self.f.tutor, campo), original[campo])
        self.assertEqual(s.Tutor.objects.filter(dni=self.f.tutor.dni).count(), 1)

    def test_tutor_ajeno_revierte_paciente_y_asignacion(self):
        datos = self.datos()
        datos['tutor']['dni'] = self.f.tutor.dni
        antes = self.f.snapshot()
        r = self.post(datos)
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(set(r.json()), {'detail'})
        self.assertEqual(self.f.snapshot(), antes)

    def test_admin_puede_primera_vinculacion(self):
        datos = self.datos()
        datos['profesional'] = self.f.profesionales['A'].pk
        datos['tutor']['dni'] = self.f.tutor.dni
        self.assertEqual(self.post(datos, 'admin').status_code, 201)

    def test_tutor_obligatorio_principal_y_campos_protegidos(self):
        cambios = [None, {}, {'responsable_principal': False}, {'activo': False},
                   {'paciente_id': self.f.pacientes['B'].pk}, {'parentesco_id': 999999}, {'telefono': ''}]
        for cambio in cambios:
            datos = self.datos()
            if cambio is None:
                datos.pop('tutor')
            elif not cambio:
                datos['tutor'] = {}
            else:
                datos['tutor'].update(cambio)
            antes = self.f.snapshot()
            self.assertEqual(self.post(datos).status_code, 400)
            self.assertEqual(self.f.snapshot(), antes)

    def test_duplicado_y_reintento_contradictorio_no_modifican(self):
        datos = self.datos()
        self.assertEqual(self.post(datos).status_code, 201)
        antes = self.f.snapshot()
        for nombre in ('Nuevo', 'Contradictorio'):
            datos['nombre'] = nombre
            self.assertEqual(self.post(datos).status_code, 400)
            self.assertEqual(self.f.snapshot(), antes)

    def test_permisos_y_asignacion(self):
        for actor in ('otro', 'sin_vinculo'):
            self.assertEqual(self.post(self.datos(), actor).status_code, 403)
        datos = self.datos()
        datos['profesional'] = self.f.profesionales['B'].pk
        antes = self.f.snapshot()
        self.assertEqual(self.post(datos).status_code, 400)
        self.assertEqual(self.f.snapshot(), antes)
        estado = s.EstadoProfesional.objects.get_or_create(estado='Inactivo')[0]
        s.Profesional.objects.filter(pk=self.f.profesionales['A'].pk).update(estado_profesional=estado)
        self.assertEqual(self.post(self.datos()).status_code, 403)

    def test_consulta_no_revela_ajenos_incompletos_ni_ausentes(self):
        for dni in (self.f.pacientes['B'].dni, self.f.pacientes['A'].dni, 'ausente'):
            self.assertEqual(self.comprobar(dni=dni).json(), {'paciente': None})
        self.assertEqual(self.comprobar('otro').status_code, 403)
        self.assertEqual(s.Client().get('/api/pacientes/alta/resultado/?dni=40123456').status_code, 401)

    def test_csrf_rechaza_sin_escrituras(self):
        c = self.f.login('A')
        antes = self.f.snapshot()
        self.assertEqual(c.post('/api/pacientes/', self.datos(), content_type='application/json').status_code, 403)
        self.assertEqual(self.f.snapshot(), antes)


if __name__ == '__main__':
    unittest.main()
