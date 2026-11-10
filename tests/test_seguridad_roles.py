"""S3: SQLite en memoria, sesiones reales y Client(enforce_csrf_checks=True).

Ejecutar por separado: venv/Scripts/python.exe -B tests/test_seguridad_roles.py
Reutiliza únicamente configuración y fixtures ficticios de S1; sin red ni migraciones.
"""
import unittest
import test_seguridad_csrf as soporte
from usuarios.models.rol_model import Permiso, RolPermiso


class SeguridadRolesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        soporte.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = soporte.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.pro = self.f.profesionales['B']
        self.url = f'/api/profesionales/{self.pro.pk}/'
        # Conceder permisos generales para probar S3 y no un rechazo previo.
        for nombre in ('profesionales.crear', 'profesionales.edit', 'profesionales.ver'):
            permiso = Permiso.objects.create(permiso=nombre, descripcion='Prueba ficticia')
            for rol in ('Administrador', 'Profesional'):
                RolPermiso.objects.create(rol=self.f.roles[rol], permiso=permiso)

    def datos(self):
        return {'nombre': 'Editado', 'apellido': 'Ficticio', 'dni': self.pro.dni,
                'matricula': self.pro.matricula, 'especialidad': self.pro.especialidad_id}

    def enviar(self, actor, metodo, url, datos, esperado):
        client = self.f.login(actor)
        antes = self.f.snapshot()
        with soporte.CaptureQueriesContext(soporte.connection) as consultas:
            respuesta = self.f.enviar(client, metodo, url, datos,
                                     HTTP_X_CSRFTOKEN=self.f.token(client))
        self.assertEqual(respuesta.status_code, esperado, respuesta.content)
        if esperado == 403:
            self.assertEqual(self.f.snapshot(), antes)
            self.assertNotIn(b'CSRF', respuesta.content)
            self.assertEqual([q['sql'] for q in consultas
                              if q['sql'].lstrip().split()[0].upper()
                              in ('INSERT', 'UPDATE', 'DELETE', 'REPLACE')], [])
        return respuesta

    def alta(self, actor, rol):
        datos = {**self.datos(), 'dni': 'NUEVO', 'matricula': 'NUEVA',
                 'usuario': 'alta_ficticia', 'password': self.f.password,
                 'rol': self.f.roles[rol].pk}
        self.enviar(actor, 'post', '/api/profesionales/', datos,
                    201 if rol == 'Profesional' else 403)
        if rol == 'Profesional':
            creado = soporte.Profesional.objects.get(dni='NUEVO')
            self.assertEqual(creado.rol_id, self.f.roles[rol].pk)
            self.assertEqual(creado.usuario.rol_id, creado.rol_id)

    def edicion(self, actor, metodo, rol):
        datos = self.datos()
        if rol != 'omitido':
            datos['rol'] = self.f.roles[rol].pk
        permitido = rol in ('omitido', 'Profesional')
        self.enviar(actor, metodo, self.url, datos, 200 if permitido else 403)
        if permitido:
            self.pro.refresh_from_db()
            self.assertEqual(self.pro.nombre, 'Editado')
            self.assertEqual(self.pro.rol_id, self.f.roles['Profesional'].pk)
            self.assertEqual(self.pro.usuario.rol_id, self.pro.rol_id)

    def proteger(self, actor, ubicacion, operacion, rol='SuperAdministrador'):
        if ubicacion in ('usuario', 'ambos'):
            self.pro.usuario.rol = self.f.roles[rol]
            self.pro.usuario.save(update_fields=['rol'])
        if ubicacion in ('profesional', 'ambos'):
            self.pro.rol = self.f.roles[rol]
            self.pro.save(update_fields=['rol'])
        if operacion in ('Activo', 'Inactivo'):
            self.pro.estado_profesional = soporte.EstadoProfesional.objects.get(
                estado='Inactivo' if operacion == 'Activo' else 'Activo')
            self.pro.save(update_fields=['estado_profesional'])
            self.pro.usuario.activo = operacion != 'Activo'
            self.pro.usuario.save(update_fields=['activo'])
            self.enviar(actor, 'patch', self.url + 'estado/', {'estado': operacion}, 403)
        else:
            # Incluye datos personales, usuario, contraseña y degradación del rol.
            self.enviar(actor, operacion, self.url,
                        {**self.datos(), 'usuario': 'tecnico_editado',
                         'password': 'NuevaFicticia123', 'rol': self.f.roles['Profesional'].pk}, 403)
            self.enviar(actor, operacion, self.url, self.datos(), 403)

    def test_estado_ordinario(self):
        for estado in ('Inactivo', 'Activo'):
            self.enviar('admin', 'patch', self.url + 'estado/', {'estado': estado}, 200)
            self.pro.refresh_from_db()
            self.assertEqual(self.pro.estado_profesional.estado, estado)
            self.assertEqual(self.pro.usuario.activo, estado == 'Activo')

    def test_credenciales_ordinarias(self):
        self.enviar('admin', 'patch', self.url,
                    {'usuario': 'renombrado', 'password': 'NuevaFicticia123'}, 200)
        self.pro.usuario.refresh_from_db()
        self.assertEqual(self.pro.usuario.usuario, 'renombrado')
        self.assertTrue(soporte.check_password('NuevaFicticia123', self.pro.usuario.password))

    def test_permisos_generales_siguen_siendo_necesarios(self):
        RolPermiso.objects.filter(rol=self.f.roles['Administrador']).delete()
        self.enviar('admin', 'patch', self.url, self.datos(), 403)
        self.enviar('admin', 'put', self.url, self.datos(), 403)
        self.enviar('admin', 'patch', self.url + 'estado/', {'estado': 'Inactivo'}, 403)
        self.enviar('admin', 'post', '/api/profesionales/',
                    {**self.datos(), 'rol': self.f.roles['Profesional'].pk}, 403)

    def test_tecnico_conserva_edicion_de_cuenta_tecnica(self):
        self.pro.rol = self.f.roles['SuperAdministrador']
        self.pro.save(update_fields=['rol'])
        self.pro.usuario.rol = self.pro.rol
        self.pro.usuario.save(update_fields=['rol'])
        self.enviar('super', 'patch', self.url, self.datos(), 200)
        self.enviar('super', 'patch', self.url + 'estado/', {'estado': 'Inactivo'}, 200)

    def test_roles_inconsistentes_no_se_reconcilian_mediante_reenvio(self):
        self.pro.usuario.rol = self.f.roles['Administrador']
        self.pro.usuario.save(update_fields=['rol'])
        for metodo in ('put', 'patch'):
            self.enviar('admin', metodo, self.url,
                        {**self.datos(), 'rol': self.pro.rol_id}, 403)
            self.enviar('admin', metodo, self.url, self.datos(), 200)
            self.pro.usuario.refresh_from_db()
            self.assertEqual(self.pro.usuario.rol_id, self.f.roles['Administrador'].pk)

    def test_profesional_con_permiso_no_edita_password_administrador(self):
        self.pro.rol = self.f.roles['Administrador']
        self.pro.save(update_fields=['rol'])
        self.pro.usuario.rol = self.pro.rol
        self.pro.usuario.save(update_fields=['rol'])
        self.enviar('A', 'patch', self.url, {'password': 'NuevaFicticia123'}, 403)

    def campo_administrador(self, ubicacion, metodo, campo):
        if ubicacion in ('usuario', 'ambos'):
            self.pro.usuario.rol = self.f.roles['Administrador']
            self.pro.usuario.save(update_fields=['rol'])
        if ubicacion in ('profesional', 'ambos'):
            self.pro.rol = self.f.roles['Administrador']
            self.pro.save(update_fields=['rol'])
        valores = {'nombre': 'Cambio rechazado', 'usuario': 'otro_ficticio',
                   'password': 'NuevaFicticia123', 'rol': self.f.roles['Administrador'].pk}
        datos = self.datos() if metodo == 'put' else {}
        datos[campo] = valores[campo]
        self.enviar('A', metodo, self.url, datos, 403)

    def test_edicion_entre_administradores_conserva_reglas_actuales(self):
        # Riesgo pendiente: profesionales.edit permite administrar otra cuenta Admin.
        self.pro.usuario.rol = self.f.roles['Administrador']
        self.pro.usuario.save(update_fields=['rol'])
        self.pro.rol = self.f.roles['Administrador']
        self.pro.save(update_fields=['rol'])
        for metodo in ('put', 'patch'):
            self.enviar('admin', metodo, self.url,
                        {**self.datos(), 'rol': self.pro.rol_id,
                         'password': 'NuevaFicticia123'}, 200)
        for estado in ('Inactivo', 'Activo'):
            self.enviar('admin', 'patch', self.url + 'estado/', {'estado': estado}, 200)

    def password_propio(self, rol_usuario, rol_profesional, esperado):
        usuario = self.f.usuarios['A']
        usuario.rol = self.f.roles[rol_usuario]
        usuario.save(update_fields=['rol'])
        profesional = self.f.profesionales['A']
        profesional.rol = self.f.roles[rol_profesional]
        profesional.save(update_fields=['rol'])
        self.enviar('A', 'post', '/api/auth/cambiar-password/',
                    {'password_actual': self.f.password, 'password_nueva': 'NuevaFicticia123'},
                    esperado)
        if esperado == 200:
            usuario.refresh_from_db()
            self.assertTrue(soporte.check_password('NuevaFicticia123', usuario.password))

    def test_password_propio_protegido_si_solo_profesional_es_tecnico(self):
        self.f.profesionales['A'].rol = self.f.roles['SuperAdministrador']
        self.f.profesionales['A'].save(update_fields=['rol'])
        self.enviar('A', 'post', '/api/auth/cambiar-password/',
                    {'password_actual': self.f.password, 'password_nueva': 'NuevaFicticia123'}, 403)

    def test_password_propio_funcional_sigue_funcionando(self):
        self.enviar('A', 'post', '/api/auth/cambiar-password/',
                    {'password_actual': self.f.password, 'password_nueva': 'NuevaFicticia123'}, 200)


def registrar(nombre, funcion, *args):
    def prueba(self):
        funcion(self, *args)
    prueba.__name__ = nombre
    setattr(SeguridadRolesTests, nombre, prueba)


for actor in ('admin', 'A', 'super'):
    for rol in ('Profesional', 'Administrador', 'SuperAdministrador', 'Otro'):
        registrar(f'test_alta_{actor}_{rol}', SeguridadRolesTests.alta, actor, rol)
for actor in ('admin', 'A'):
    for metodo in ('put', 'patch'):
        for rol in ('omitido', 'Profesional', 'Administrador', 'SuperAdministrador', 'Otro'):
            registrar(f'test_edicion_{actor}_{metodo}_{rol}', SeguridadRolesTests.edicion,
                      actor, metodo, rol)
    for ubicacion in ('usuario', 'profesional', 'ambos'):
        for operacion in ('put', 'patch', 'Activo', 'Inactivo'):
            registrar(f'test_tecnico_{actor}_{ubicacion}_{operacion}',
                      SeguridadRolesTests.proteger, actor, ubicacion, operacion)

for ubicacion in ('usuario', 'profesional', 'ambos'):
    for operacion in ('put', 'patch', 'Activo', 'Inactivo'):
        registrar(f'test_administrador_protegido_{ubicacion}_{operacion}',
                  SeguridadRolesTests.proteger, 'A', ubicacion, operacion, 'Administrador')
    for metodo in ('put', 'patch'):
        for campo in ('nombre', 'usuario', 'password', 'rol'):
            registrar(f'test_campo_administrador_{ubicacion}_{metodo}_{campo}',
                      SeguridadRolesTests.campo_administrador, ubicacion, metodo, campo)

for rol_usuario, rol_profesional, esperado in (
    ('Profesional', 'Profesional', 200),
    ('Administrador', 'Administrador', 200),
    ('Administrador', 'Profesional', 200),
    ('SuperAdministrador', 'SuperAdministrador', 200),
    ('Profesional', 'Administrador', 403),
):
    registrar(f'test_password_propio_{rol_usuario}_{rol_profesional}',
              SeguridadRolesTests.password_propio, rol_usuario, rol_profesional, esperado)


if __name__ == '__main__':
    unittest.main(verbosity=2)
