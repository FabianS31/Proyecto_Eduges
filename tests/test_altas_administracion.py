"""Integración local: sesiones/CSRF reales y SQLite en memoria, sin migraciones."""
import unittest
from unittest.mock import patch
import test_seguridad_csrf as soporte
from usuarios.models.rol_model import Permiso, RolPermiso
from django.db import IntegrityError


class AltasAdministracionTests(unittest.TestCase):
    admin_url = '/api/auth/administradores/'
    esp_url = '/api/profesionales/especialidades/'
    datos = {'usuario': 'nuevo_admin', 'password': 'ClaveFicticia123'}

    @classmethod
    def setUpClass(cls):
        soporte.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = soporte.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.permiso = Permiso.objects.create(permiso='usuarios.admin', descripcion='Administración')
        RolPermiso.objects.create(rol=self.f.roles['Administrador'], permiso=self.permiso)

    def post(self, client, url, datos):
        return client.post(url, datos, content_type='application/json',
                           HTTP_X_CSRFTOKEN=self.f.token(client))

    def test_admin_creado_hash_rol_fijo_y_login(self):
        client = self.f.login('admin')
        respuesta = self.post(client, self.admin_url, self.datos)
        self.assertEqual(respuesta.status_code, 201, respuesta.content)
        usuario = soporte.Usuario.objects.get(usuario=self.datos['usuario'])
        self.assertEqual(usuario.rol.rol, 'Administrador')
        self.assertTrue(usuario.activo)
        self.assertTrue(soporte.check_password(self.datos['password'], usuario.password))
        self.assertNotIn('password', respuesta.json())
        self.assertNotIn(self.datos['password'], respuesta.content.decode())
        self.assertFalse(soporte.Profesional.objects.filter(usuario=usuario).exists())
        self.assertEqual(self.post(client, '/api/auth/login/', self.datos).status_code, 200)

    def test_permisos_roles_y_csrf(self):
        RolPermiso.objects.create(rol=self.f.roles['Profesional'], permiso=self.permiso)
        for url, datos in ((self.admin_url, self.datos), (self.esp_url, {'nombre': 'Nueva'})):
            self.assertEqual(soporte.Client().post(url, datos).status_code, 401)
            for actor in ('A', 'otro'):
                self.assertEqual(self.post(self.f.login(actor), url, datos).status_code, 403)
            client = self.f.login('admin')
            self.assertEqual(client.post(url, datos, content_type='application/json').status_code, 403)
        RolPermiso.objects.filter(rol=self.f.roles['Administrador']).delete()
        for url, datos in ((self.admin_url, self.datos), (self.esp_url, {'nombre': 'Nueva'})):
            self.assertEqual(self.post(self.f.login('admin'), url, datos).status_code, 403)
            self.assertEqual(self.post(self.f.login('super'), url, datos).status_code, 201)

    def test_inactivo_rechazado(self):
        client = self.f.login('admin')
        usuario = self.f.usuarios['admin']
        usuario.activo = False
        usuario.save()
        for url, datos in ((self.admin_url, self.datos), (self.esp_url, {'nombre': 'Nueva'})):
            self.assertEqual(self.post(client, url, datos).status_code, 401)

    def test_validaciones_admin_y_campos_privilegiados_sin_escrituras(self):
        client = self.f.login('admin')
        antes = soporte.Usuario.objects.count()
        casos = [dict(self.datos, **{campo: valor}) for campo, valor in (
            ('usuario', ''), ('usuario', 'a b'), ('usuario', 'x' * 101),
            ('password', ''), ('password', 'corta'), ('password', ' ' * 8),
            ('password', 'x' * 129), ('rol', 'SuperAdministrador'), ('rol', 'Recepcionista'),
            ('password', ' ClaveFicticia123'), ('password', 'ClaveFicticia123 '),
            ('activo', False), ('id', 777), ('usuario', 'ficticio_admin'))]
        casos += [{'usuario': 'nuevo'}, {'password': 'ClaveFicticia123'}]
        for datos in casos:
            with self.subTest(datos={k: v for k, v in datos.items() if k != 'password'}):
                self.assertEqual(self.post(client, self.admin_url, datos).status_code, 400)
                self.assertEqual(soporte.Usuario.objects.count(), antes)

    def test_especialidad_catalogo_validacion_duplicado(self):
        client = self.f.login('admin')
        respuesta = self.post(client, self.esp_url, {'nombre': '  Nueva especialidad  '})
        self.assertEqual(respuesta.status_code, 201, respuesta.content)
        creada = respuesta.json()
        self.assertEqual(creada['nombre'], 'Nueva especialidad')
        self.assertIn(creada, self.f.login('A').get(self.esp_url).json())
        cantidad = soporte.Especialidad.objects.count()
        for nombre in ('', '   ', 'x' * 101, 'Nueva especialidad', ' Nueva especialidad '):
            self.assertEqual(self.post(client, self.esp_url, {'nombre': nombre}).status_code, 400)
        self.assertEqual(soporte.Especialidad.objects.count(), cantidad)
        self.assertEqual(soporte.Client().get(self.esp_url).status_code, 401)

    def test_catalogo_nuevo_alta_profesional_transaccional(self):
        permiso = Permiso.objects.create(permiso='profesionales.crear', descripcion='Alta')
        RolPermiso.objects.create(rol=self.f.roles['Administrador'], permiso=permiso)
        client = self.f.login('admin')
        esp = self.post(client, self.esp_url, {'nombre': 'Nueva especialidad'}).json()
        datos = dict(nombre='Nuevo', apellido='Profesional', dni='12345678', matricula='NUEVA',
                     especialidad=esp['id'], rol=self.f.roles['Profesional'].pk,
                     usuario='nuevo_prof', password='ClaveFicticia123')
        respuesta = self.post(client, '/api/profesionales/', datos)
        self.assertEqual(respuesta.status_code, 201, respuesta.content)
        prof = soporte.Profesional.objects.get(usuario__usuario='nuevo_prof')
        self.assertEqual(prof.especialidad_id, esp['id'])
        self.assertTrue(soporte.check_password(datos['password'], prof.usuario.password))
        self.assertEqual(prof.usuario.rol.rol, 'Profesional')
        self.assertEqual(self.post(client, '/api/profesionales/', datos).status_code, 400)
        datos.update(usuario='rollback_prof', dni='87654321', matricula='OTRA')
        with patch.object(soporte.Profesional.objects, 'create', side_effect=IntegrityError('simulado')):
            with self.assertRaises(IntegrityError):
                self.post(client, '/api/profesionales/', datos)
        self.assertFalse(soporte.Usuario.objects.filter(usuario='rollback_prof').exists())


if __name__ == '__main__':
    unittest.main()
