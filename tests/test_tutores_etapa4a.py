"""Rutas reales, sesiones y CSRF; datos ficticios en SQLite :memory:."""
import unittest
from datetime import date
from unittest.mock import patch
import test_seguridad_csrf as soporte


class TutoresEtapa4ATests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        soporte.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = soporte.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.url = f'/api/tutores/relaciones/{self.f.principal.pk}/'
        self.reemplazo = self.url + 'reemplazar-principal/'

    def enviar(self, actor, metodo, url, datos=None):
        client = self.f.login(actor)
        return getattr(client, metodo)(url, datos or {}, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(client))

    def datos(self, paciente='A'):
        return dict(nombre='No sobrescribir', apellido='Otro', dni=self.f.tutor.dni,
                    telefono='999', movil='888', mail='nuevo@example.com', domicilio='Otro',
                    paciente_id=self.f.pacientes[paciente].pk, parentesco_id=self.f.parentesco.pk)

    def test_ultimo_principal_protegido_para_todos_los_roles(self):
        for actor in ('B', 'admin', 'super'):
            for metodo, datos in (('delete', {}), ('patch', {'responsable_principal': False}), ('patch', {'activo': False})):
                antes = self.f.snapshot()
                r = self.enviar(actor, metodo, self.url, datos)
                self.assertEqual(r.status_code, 400, r.content)
                self.assertEqual(self.f.snapshot(), antes)

    def test_reemplazo_explicito_y_baja_del_anterior(self):
        r = self.enviar('B', 'post', self.reemplazo, {'nueva_relacion_id': self.f.relacion.pk})
        self.assertEqual(r.status_code, 200, r.content)
        self.f.principal.refresh_from_db()
        self.f.relacion.refresh_from_db()
        self.assertTrue(self.f.principal.activo)
        self.assertFalse(self.f.principal.responsable_principal)
        self.assertTrue(self.f.relacion.responsable_principal)
        self.assertEqual(self.enviar('B', 'delete', self.url).status_code, 200)
        self.assertEqual(self.enviar('B', 'delete', self.f.url).status_code, 400)

    def test_reemplazo_rechaza_ajenos_inactivos_y_datos_desactualizados(self):
        for actor in ('A', 'otro', 'sin_vinculo'):
            self.assertEqual(self.enviar(actor, 'post', self.reemplazo, {'nueva_relacion_id': self.f.relacion.pk}).status_code, 403)
        for datos in ({'nueva_relacion_id': self.f.principal.pk}, {'nueva_relacion_id': 999999},
                      {'nueva_relacion_id': self.f.relacion.pk, 'paciente_id': self.f.pacientes['A'].pk}):
            antes = self.f.snapshot()
            self.assertEqual(self.enviar('B', 'post', self.reemplazo, datos).status_code, 400)
            self.assertEqual(self.f.snapshot(), antes)
        self.f.relacion.activo = False
        self.f.relacion.save()
        self.assertEqual(self.enviar('B', 'post', self.reemplazo, {'nueva_relacion_id': self.f.relacion.pk}).status_code, 400)

    def test_reemplazo_no_repara_inconsistencias_antiguas(self):
        self.f.relacion.responsable_principal = True
        self.f.relacion.save()
        antes = self.f.snapshot()
        self.assertEqual(self.enviar('B', 'post', self.reemplazo, {'nueva_relacion_id': self.f.relacion.pk}).status_code, 400)
        self.assertEqual(self.f.snapshot(), antes)

    def test_reemplazo_es_atomico_ante_fallo_del_segundo_guardado(self):
        antes = self.f.snapshot()
        save = soporte.PacienteTutor.save
        def fallar(obj, *args, **kwargs):
            if obj.pk == self.f.relacion.pk:
                raise RuntimeError('Fallo simulado')
            return save(obj, *args, **kwargs)
        with patch.object(soporte.PacienteTutor, 'save', fallar):
            with self.assertRaises(RuntimeError):
                self.enviar('B', 'post', self.reemplazo, {'nueva_relacion_id': self.f.relacion.pk})
        self.assertEqual(self.f.snapshot(), antes)

    def test_dni_ajeno_no_vincula_no_modifica_no_revela(self):
        antes = self.f.snapshot()
        r = self.enviar('A', 'post', '/api/tutores/', self.datos())
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(set(r.json()), {'detail'})
        self.assertNotIn(self.f.tutor.mail, r.content.decode())
        self.assertEqual(self.f.snapshot(), antes)
        self.assertEqual(self.enviar('A', 'get', f'/api/tutores/{self.f.tutor.pk}/').status_code, 403)

    def test_admin_vincula_sin_sobrescribir_y_profesionales_editan_compartido(self):
        antes = soporte.Tutor.objects.get(pk=self.f.tutor.pk).__dict__.copy()
        r = self.enviar('admin', 'post', '/api/tutores/', self.datos())
        self.assertEqual(r.status_code, 201, r.content)
        self.f.tutor.refresh_from_db()
        for campo in ('nombre','apellido','dni','telefono','movil','mail','domicilio'):
            self.assertEqual(getattr(self.f.tutor, campo), antes[campo])
        self.assertEqual(soporte.Tutor.objects.filter(dni=self.f.tutor.dni).count(), 1)
        for actor in ('A', 'B'):
            r = self.enviar(actor, 'patch', f'/api/tutores/{self.f.tutor.pk}/', {'telefono': actor})
            self.assertEqual(r.status_code, 200, r.content)
            self.assertEqual({x['paciente']['id'] for x in r.json()['relaciones']}, {self.f.pacientes[actor].pk})
        self.f.tutor.refresh_from_db()
        self.assertEqual(self.f.tutor.telefono, 'B')

    def test_reutilizacion_autorizada_sin_duplicados_ni_sobrescritura(self):
        soporte.AsignacionProfesional.objects.create(paciente=self.f.pacientes['A'], profesional=self.f.profesionales['B'], fecha_inicio=date.today())
        r = self.enviar('B', 'post', '/api/tutores/', self.datos())
        self.assertEqual(r.status_code, 201, r.content)
        self.f.tutor.refresh_from_db()
        self.assertEqual(self.f.tutor.nombre, 'Tutor')
        antes = self.f.snapshot()
        self.assertEqual(self.enviar('B', 'post', '/api/tutores/', self.datos()).status_code, 400)
        self.assertEqual(self.f.snapshot(), antes)

    def test_edicion_rechaza_dni_duplicado_y_campos_invalidos(self):
        url = f'/api/tutores/{self.f.tutor.pk}/'
        for datos in ({'dni': self.f.principal.tutor.dni}, {'mail': ''}, {'domicilio': ''}, {'dni': ''}):
            antes = self.f.snapshot()
            self.assertEqual(self.enviar('B', 'patch', url, datos).status_code, 400)
            self.assertEqual(self.f.snapshot(), antes)

    def test_asignacion_finalizada_no_autoriza_escrituras(self):
        soporte.AsignacionProfesional.objects.filter(profesional=self.f.profesionales['B']).update(fecha_fin=date.today())
        for metodo, url, datos in (
            ('post', self.reemplazo, {'nueva_relacion_id': self.f.relacion.pk}),
            ('patch', f'/api/tutores/{self.f.tutor.pk}/', {'telefono': 'No'}),
            ('delete', self.url, {}),
        ):
            self.assertEqual(self.enviar('B', metodo, url, datos).status_code, 403)


if __name__ == '__main__':
    unittest.main()
