"""H10: teléfonos ficticios, SQLite en memoria; sin garantías de concurrencia real."""
import unittest
from unittest.mock import patch
import test_seguridad_csrf as s
import test_altas_etapa4b as altas


class TelefonoPrincipalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()

    def enviar(self, url, datos, actor='B', metodo='patch'):
        c = self.f.login(actor)
        return getattr(c, metodo)(url, datos, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c))

    def reemplazar(self, actor='B'):
        return self.enviar(f'/api/tutores/relaciones/{self.f.principal.pk}/reemplazar-principal/',
                           {'nueva_relacion_id':self.f.relacion.pk}, actor, 'post')

    def test_reemplazo_exige_telefono_no_movil_y_conserva_anterior(self):
        for valor in (None, '', ' \t '):
            s.Tutor.objects.filter(pk=self.f.tutor.pk).update(telefono=valor, movil='123')
            antes = self.f.snapshot()
            r = self.reemplazar()
            self.assertEqual(r.status_code, 400, r.content)
            self.assertIn('telefono', r.json())
            self.assertEqual(self.f.snapshot(), antes)
        s.Tutor.objects.filter(pk=self.f.tutor.pk).update(telefono='123')
        self.assertEqual(self.reemplazar().status_code, 200)
        self.f.principal.refresh_from_db()
        self.f.relacion.refresh_from_db()
        self.assertFalse(self.f.principal.responsable_principal)
        self.assertTrue(self.f.relacion.responsable_principal)

    def test_principal_compartido_no_puede_vaciarse_sin_filtrar_pacientes(self):
        s.PacienteTutor.objects.create(tutor=self.f.tutor,paciente=self.f.pacientes['A'],
            parentesco=self.f.parentesco,activo=True,responsable_principal=True)
        s.Tutor.objects.filter(pk=self.f.tutor.pk).update(telefono='123')
        for valor in (None, '', '   '):
            antes = self.f.snapshot()
            r = self.enviar(f'/api/tutores/{self.f.tutor.pk}/', {'telefono':valor})
            self.assertEqual(r.status_code, 400, r.content)
            self.assertEqual(set(r.json()), {'telefono'})
            self.assertNotIn(self.f.pacientes['A'].nombre, r.content.decode())
            self.assertEqual(self.f.snapshot(), antes)
        self.assertEqual(self.enviar(f'/api/tutores/{self.f.tutor.pk}/', {'telefono':'456'}).status_code,200)

    def test_historico_principal_edicion_ajena_permitida(self):
        tutor = self.f.principal.tutor
        s.Tutor.objects.filter(pk=tutor.pk).update(telefono=None)
        r = self.enviar(f'/api/tutores/{tutor.pk}/', {'nombre':'Nombre Ficticio'})
        self.assertEqual(r.status_code, 200, r.content)
        tutor.refresh_from_db()
        self.assertIsNone(tutor.telefono)

    def test_adicional_nuevo_sin_telefono_o_con_telefono(self):
        for valor in (None, '', '123'):
            with self.subTest(valor=valor), s.transaction.atomic():
                datos = dict(nombre='Nuevo',apellido='Ficticio',dni='12345678',mail='ficticio@example.com',
                    domicilio='Ficticio',paciente_id=self.f.pacientes['B'].pk,parentesco_id=self.f.parentesco.pk,
                    telefono=valor,responsable_principal=False)
                r = self.enviar('/api/tutores/',datos,metodo='post')
                self.assertEqual(r.status_code,201,r.content)
                s.transaction.set_rollback(True)

    def test_alta_integral_nueva_con_y_sin_telefono(self):
        for telefono in (None, '', ' ', '123'):
            with self.subTest(telefono=telefono), s.transaction.atomic():
                datos = altas.AltaTests.datos(self)
                datos['tutor']['telefono'] = telefono
                antes = self.f.snapshot()
                r = self.enviar('/api/pacientes/',datos,metodo='post')
                self.assertEqual(r.status_code,201 if telefono=='123' else 400,r.content)
                if telefono!='123': self.assertEqual(self.f.snapshot(),antes)
                s.transaction.set_rollback(True)

    def test_reutilizacion_no_sobrescribe_telefono_y_rechaza_principal_sin_contacto(self):
        s.Tutor.objects.filter(pk=self.f.tutor.pk).update(telefono=None)
        datos = altas.AltaTests.datos(self)
        datos['tutor']['dni'] = self.f.tutor.dni
        datos['tutor']['telefono'] = 'No se debe copiar'
        antes = self.f.snapshot()
        r = self.enviar('/api/pacientes/',datos,metodo='post')
        self.assertEqual(r.status_code,400,r.content)
        self.assertEqual(self.f.snapshot(),antes)
        # Sí puede vincularse como adicional a otro paciente desde un rol autorizado.
        r = self.enviar('/api/tutores/',dict(dni=self.f.tutor.dni,paciente_id=self.f.pacientes['A'].pk,
            parentesco_id=self.f.parentesco.pk,responsable_principal=False),'admin','post')
        self.assertEqual(r.status_code,201,r.content)
        self.f.tutor.refresh_from_db()
        self.assertIsNone(self.f.tutor.telefono)

    def test_patch_promocion_y_reactivacion_exigen_telefono(self):
        s.PacienteTutor.objects.filter(pk=self.f.principal.pk).update(responsable_principal=False)
        s.Tutor.objects.filter(pk=self.f.tutor.pk).update(telefono=None)
        for activo in (True,False):
            s.PacienteTutor.objects.filter(pk=self.f.relacion.pk).update(activo=activo,responsable_principal=not activo)
            antes=self.f.snapshot()
            r=self.enviar(self.f.url,{'activo':True,'responsable_principal':True})
            self.assertEqual(r.status_code,400,r.content)
            self.assertEqual(self.f.snapshot(),antes)

    def test_permiso_precede_contacto(self):
        antes=self.f.snapshot()
        self.assertEqual(self.reemplazar('A').status_code,403)
        self.assertEqual(self.enviar(f'/api/tutores/{self.f.tutor.pk}/',{'telefono':None},'A').status_code,403)
        self.assertEqual(self.f.snapshot(),antes)

    def test_rollback_reemplazo(self):
        s.Tutor.objects.filter(pk=self.f.tutor.pk).update(telefono='123')
        antes=self.f.snapshot()
        guardar=s.PacienteTutor.save
        def fallar(obj,*args,**kwargs):
            if obj.pk==self.f.relacion.pk: raise RuntimeError('Fallo ficticio')
            return guardar(obj,*args,**kwargs)
        with patch.object(s.PacienteTutor,'save',fallar):
            with self.assertRaises(RuntimeError): self.reemplazar()
        self.assertEqual(self.f.snapshot(),antes)


if __name__=='__main__':
    unittest.main()
