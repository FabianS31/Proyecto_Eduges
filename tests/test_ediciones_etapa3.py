"""Ediciones aisladas con sesión/CSRF reales y SQLite :memory:, sin migraciones."""
import unittest
from datetime import date, timedelta
import test_seguridad_csrf as soporte
from usuarios.models.rol_model import Permiso, RolPermiso


class EdicionesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        soporte.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = soporte.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.paciente = self.f.pacientes['A']
        self.url = f'/api/pacientes/{self.paciente.pk}/'
        self.obra = self.paciente.obra_social
        self.os_url = f'/api/obras-sociales/{self.obra.pk}/'
        permiso = Permiso.objects.create(permiso='obras_sociales.edit', descripcion='Edición')
        RolPermiso.objects.create(rol=self.f.roles['Administrador'], permiso=permiso)

    def patch(self, client, url, datos):
        return client.patch(url, datos, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(client))

    def test_paciente_propio_solo_cambios_autorizados(self):
        antes = self.f.snapshot()
        datos = dict(nombre='Nuevo', apellido='Apellido', dni='12345678', fecha_nacimiento='2011-01-01',
                     direccion='Nueva dirección', mail='prueba@example.com', cud_numero='CUD-123',
                     cud_vencimiento='2020-01-01', numero_afiliado='AF-2')
        r = self.patch(self.f.login('A'), self.url, datos)
        self.assertEqual(r.status_code, 200, r.content)
        for campo, valor in datos.items():
            self.assertEqual(r.json()[campo], valor)
        despues = self.f.snapshot()
        etiqueta = self.paciente._meta.label
        for modelo in antes:
            if modelo != etiqueta:
                self.assertEqual(antes[modelo], despues[modelo], modelo)
        self.paciente.refresh_from_db()
        original = next(p for p in antes[etiqueta] if p['id_paciente'] == self.paciente.pk)
        for campo in ('estado_id', 'fecha_alta', 'consentimiento'):
            self.assertEqual(getattr(self.paciente, campo), original[campo])

    def test_ajenos_y_roles_no_autorizados_sin_escrituras(self):
        antes = self.f.snapshot()
        for actor in ('B', 'sin_vinculo', 'admin', 'super', 'otro'):
            with self.subTest(actor=actor):
                self.assertEqual(self.patch(self.f.login(actor), self.url, {'nombre': 'No'}).status_code, 403)
                self.assertEqual(self.f.snapshot(), antes)
        self.assertEqual(soporte.Client().patch(self.url, {}, content_type='application/json').status_code, 401)

    def test_reasignado_antes_de_guardar(self):
        client = self.f.login('A')
        soporte.AsignacionProfesional.objects.filter(paciente=self.paciente, fecha_fin__isnull=True).update(fecha_fin=date.today())
        soporte.AsignacionProfesional.objects.create(paciente=self.paciente, profesional=self.f.profesionales['B'], fecha_inicio=date.today())
        antes = self.f.snapshot()
        self.assertEqual(self.patch(client, self.url, {'nombre': 'No'}).status_code, 403)
        self.assertEqual(self.f.snapshot(), antes)
        self.assertEqual(self.patch(self.f.login('B'), self.url, {'nombre': 'Sí'}).status_code, 200)

    def test_campos_protegidos_rechazados_incluso_con_cambios_validos(self):
        client = self.f.login('A')
        antes = self.f.snapshot()
        for campo in ('profesional', 'profesional_responsable', 'estado', 'fecha_alta', 'consentimiento',
                      'tutores', 'sesiones', 'trabajo_sesion', 'diagnostico', 'telefono', 'id_paciente', 'inesperado'):
            r = self.patch(client, self.url, {'nombre': 'No', campo: 1})
            self.assertEqual(r.status_code, 400, (campo, r.content))
            self.assertIn(campo, r.json())
            self.assertEqual(self.f.snapshot(), antes)

    def test_validaciones_y_errores_sin_escrituras(self):
        client = self.f.login('A')
        antes = self.f.snapshot()
        for campo, valor in (
            ('dni', self.f.pacientes['B'].dni), ('nombre', ''), ('apellido', ' '), ('direccion', ''),
            ('fecha_nacimiento', '2026-02-30'), ('fecha_nacimiento', str(date.today()+timedelta(days=1))),
            ('cud_numero', 'x'*21), ('cud_vencimiento', 'no-fecha'), ('cud_vencimiento', '2026-02-30'),
            ('mail', 'invalido'), ('obra_social', 999999), ('obra_social', None), ('numero_afiliado', ''),
        ):
            r = self.patch(client, self.url, {campo: valor})
            self.assertEqual(r.status_code, 400, (campo, r.content))
            self.assertEqual(self.f.snapshot(), antes)
        self.assertEqual(self.patch(client, self.url, {'dni': self.paciente.dni}).status_code, 200)
        self.assertEqual(self.patch(client, self.url, {'cud_numero': None, 'cud_vencimiento': None}).status_code, 200)
        self.assertEqual(self.patch(client, self.url, [{'nombre': 'incorrecto'}]).status_code, 400)

    def test_cambio_cobertura_y_conservacion_de_inactiva(self):
        client = self.f.login('A')
        inactiva = soporte.EstadoObraSocial.objects.create(descripcion='Inactiva')
        nueva = soporte.ObraSocial.objects.create(nombre='Nueva', tipo=self.obra.tipo, estado=inactiva)
        self.assertEqual(self.patch(client, self.url, {'obra_social': nueva.pk}).status_code, 400)
        nueva.estado = self.obra.estado
        nueva.save()
        r = self.patch(client, self.url, {'obra_social': nueva.pk, 'numero_afiliado': 'NUEVO'})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['obra_social']['id'], nueva.pk)
        nueva.estado = inactiva
        nueva.save()
        self.assertEqual(self.patch(client, self.url, {'direccion': 'Otra'}).status_code, 200)
        self.assertEqual(self.patch(client, self.url, {'obra_social': nueva.pk}).status_code, 200)

    def test_obra_social_edicion_y_duplicados(self):
        client = self.f.login('admin')
        datos = dict(nombre='Cobertura editada', contacto='123', mail='obra@example.com', web='https://example.com')
        r = self.patch(client, self.os_url, datos)
        self.assertEqual(r.status_code, 200, r.content)
        for campo, valor in datos.items():
            self.assertEqual(r.json()[campo], valor)
        original_tipo, original_estado = self.obra.tipo_id, self.obra.estado_id
        self.obra.refresh_from_db()
        self.assertEqual((self.obra.tipo_id, self.obra.estado_id), (original_tipo, original_estado))
        self.assertEqual(self.patch(client, self.os_url, {'nombre': datos['nombre']}).status_code, 200)
        soporte.ObraSocial.objects.create(nombre='Ótra cobertura', tipo=self.obra.tipo, estado=self.obra.estado)
        self.assertEqual(self.patch(client, self.os_url, {'nombre': 'OTRA COBERTURA'}).status_code, 400)

    def test_obra_social_formatos_solo_campos_enviados(self):
        client = self.f.login('admin')
        for datos in ({'mail': 'invalido'}, {'web': 'javascript:alert(1)'}, {'nombre': ' '}, {'web': 'sin-url'}):
            self.assertEqual(self.patch(client, self.os_url, datos).status_code, 400)
        for datos in ({'mail': None, 'web': ''}, {'mail': '', 'web': None}):
            self.assertEqual(self.patch(client, self.os_url, datos).status_code, 200)
        # Datos antiguos inválidos no bloquean una edición parcial de otros campos.
        self.obra.mail = 'dato-antiguo'
        self.obra.save()
        self.assertEqual(self.patch(client, self.os_url, {'contacto': '456'}).status_code, 200)

    def test_permisos_y_csrf_obra_social_y_paciente(self):
        client = self.f.login('admin')
        self.assertEqual(self.patch(self.f.login('A'), self.os_url, {'nombre': 'No'}).status_code, 403)
        RolPermiso.objects.filter(rol=self.f.roles['Administrador']).delete()
        self.assertEqual(self.patch(client, self.os_url, {'nombre': 'No'}).status_code, 403)
        for actor, url in (('super', self.os_url), ('A', self.url)):
            client = self.f.login(actor)
            antes = self.f.snapshot()
            for headers in ({}, {'HTTP_X_CSRFTOKEN': 'incorrecto'}):
                r = client.patch(url, {'nombre': 'No'}, content_type='application/json', **headers)
                self.assertEqual(r.status_code, 403)
                self.assertEqual(self.f.snapshot(), antes)

    def test_h08_campos_invalidos_no_escriben(self):
        c = self.f.login('A')
        for campo, valores in {
            'nombre': ['', '   ', 'A'*101], 'apellido': ['', '   ', 'A'*101],
            'direccion': ['', '   ', 'A'*256], 'numero_afiliado': ['', '   ', 'A'*21],
            'mail': ['incorrecto', 'a@dominio', 'a'*39+'@example.com'],
            'fecha_nacimiento': ['', '2099-01-01', '2025-02-30'],
            'cud_vencimiento': ['2025-02-30'], 'cud_numero': ['A'*21],
        }.items():
            for valor in valores:
                antes = self.f.snapshot()
                r = self.patch(c, self.url, {campo: valor})
                self.assertEqual(r.status_code, 400, (campo, r.content))
                self.assertEqual(self.f.snapshot(), antes)
        for campo, valor in dict(nombre='A'*60, apellido='A'*60, direccion='A'*255,
                numero_afiliado='A'*20, cud_numero='A'*20, mail='a'*38+'@example.com',
                fecha_nacimiento='2012-02-29').items():
            datos = {campo: valor}
            if campo == 'cud_numero':
                datos['cud_vencimiento'] = '2027-01-01'
            self.assertEqual(self.patch(c, self.url, datos).status_code, 200, campo)

    def test_h08_h09_obra_limites_y_formatos(self):
        c = self.f.login('admin')
        for campo, valido, invalido in [
            ('nombre', 'A'*150, 'A'*151), ('contacto', 'A'*150, 'A'*151),
            ('mail', 'a'*138+'@example.com', 'a'*139+'@example.com'),
            ('web', 'https://example.com/'+'a'*235, 'https://example.com/'+'a'*236),
        ]:
            self.assertEqual(self.patch(c, self.os_url, {campo: valido}).status_code, 200, campo)
            antes = self.f.snapshot()
            self.assertEqual(self.patch(c, self.os_url, {campo: invalido}).status_code, 400, campo)
            self.assertEqual(self.f.snapshot(), antes)
        for campo, valor in [('nombre','   '), ('mail','invalido'), ('web','https://')]:
            antes = self.f.snapshot()
            self.assertEqual(self.patch(c, self.os_url, {campo: valor}).status_code, 400)
            self.assertEqual(self.f.snapshot(), antes)

    def test_h08_historicos_sin_cambios_problematicos(self):
        soporte.Paciente.objects.filter(pk=self.paciente.pk).update(
            mail='invalido', fecha_nacimiento=date(2099,1,1), direccion='A'*256)
        self.assertEqual(self.patch(self.f.login('A'), self.url, {'nombre':'Nuevo'}).status_code, 200)
        self.paciente.refresh_from_db()
        self.assertEqual(self.paciente.mail, 'invalido')
        self.assertEqual(self.paciente.direccion, 'A'*256)
        soporte.ObraSocial.objects.filter(pk=self.obra.pk).update(mail='invalido',web='invalido')
        self.assertEqual(self.patch(self.f.login('admin'), self.os_url, {'nombre':'Nueva'}).status_code, 200)


    def test_h02_cud_patch_final_e_historicos(self):
        c = self.f.login('A')
        for numero, fecha, cambios, esperado in [
            (None, None, {'cud_numero': 'N'}, 400),
            (None, None, {'cud_vencimiento': '2027-01-01'}, 400),
            ('N', date(2027,1,1), {'cud_numero': None}, 400),
            ('N', date(2027,1,1), {'cud_vencimiento': None}, 400),
            (None, None, {'nombre': 'Otro'}, 200),
            (None, None, {'cud_numero': 'CUD-HIST', 'cud_vencimiento': '2020-01-01'}, 200),
            ('N', date(2027,1,1), {'cud_numero': None, 'cud_vencimiento': None}, 400),
            ('N', date(2027,1,1), {'cud_numero': 'Nuevo'}, 200),
            ('N', None, {'nombre': 'Otro'}, 200),
            (None, date(2027,1,1), {'nombre': 'Otro'}, 200),
            ('N', None, {'cud_numero': 'Nuevo'}, 400),
            ('N', None, {'cud_vencimiento': '2027-01-01'}, 200),
            ('N', None, {'cud_numero': ''}, 200),
        ]:
            soporte.Paciente.objects.filter(pk=self.paciente.pk).update(cud_numero=numero,cud_vencimiento=fecha)
            antes = self.f.snapshot()
            r = self.patch(c, self.url, cambios)
            self.assertEqual(r.status_code, esperado, r.content)
            if esperado == 400:
                self.assertEqual(self.f.snapshot(), antes)
                self.assertTrue({'cud_numero','cud_vencimiento'} & r.json().keys())
            elif 'nombre' in cambios:
                self.paciente.refresh_from_db()
                self.assertEqual((self.paciente.cud_numero,self.paciente.cud_vencimiento),(numero,fecha))

    def test_etapa3_reactivacion_historico_sin_cud(self):
        soporte.Paciente.objects.filter(pk=self.paciente.pk).update(cud_numero=None, cud_vencimiento=None)
        c = self.f.login('A')
        r_baja = self.patch(c, f'/api/pacientes/{self.paciente.pk}/estado/', {'estado': 'Inactivo'})
        self.assertEqual(r_baja.status_code, 200, r_baja.content)
        r_alta = self.patch(c, f'/api/pacientes/{self.paciente.pk}/estado/', {'estado': 'Activo'})
        self.assertEqual(r_alta.status_code, 200, r_alta.content)
        self.paciente.refresh_from_db()
        self.assertIsNone(self.paciente.cud_numero)
        self.assertIsNone(self.paciente.cud_vencimiento)

if __name__ == '__main__':
    unittest.main()
