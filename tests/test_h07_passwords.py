"""H07: secretos ficticios y SQLite exclusivamente en memoria."""
import unittest
import logging
from types import SimpleNamespace
import test_seguridad_csrf as s
from rest_framework import serializers
from APIs.autenticacion.serializers.autenticacion_serializer import LoginSerializer, CambiarPasswordSerializer
from APIs.autenticacion.serializers.administrador_serializer import AdministradorEntradaSerializer
from APIs.profesionales.serializers.profesionales_serializer import ProfesionalSerializer


class PasswordTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.c = self.f.login('super')

    def enviar(self, url, datos, metodo='post', cliente=None):
        c = cliente or self.c
        return getattr(c, metodo)(url, datos, content_type='application/json',
                                 HTTP_X_CSRFTOKEN=self.f.token(c))

    def destinos(self):
        return [('/api/auth/administradores/', {'usuario':'nuevo_ficticio'}, 'post'),
                ('/api/profesionales/', dict(nombre='Nuevo', apellido='Ficticio', dni='12345678',
                 matricula='FICTICIA', especialidad=self.f.profesionales['A'].especialidad_id,
                 rol=self.f.roles['Profesional'].pk, usuario='nuevo_ficticio'), 'post'),
                (f'/api/profesionales/{self.f.profesionales["A"].pk}/', {}, 'patch')]

    def test_rechazo_exterior_sin_escrituras_ni_secreto_en_respuesta(self):
        for blanco in (' ', '\t', '\n', '\r', '\u00a0', '\u0085', '\u001c'):
            for valor in (blanco + 'Ficticia123', 'Ficticia123' + blanco):
                for url, datos, metodo in self.destinos():
                    antes = self.f.snapshot()
                    r = self.enviar(url, dict(datos, password=valor), metodo)
                    self.assertEqual(r.status_code, 400, (url, r.content))
                    self.assertIn('password', r.json())
                    self.assertNotIn('Ficticia123', r.content.decode())
                    self.assertEqual(self.f.snapshot(), antes)

    def test_altas_y_edicion_preservan_espacios_interiores_y_hash(self):
        for valor in ('Ficticia 123', 'Ficticia\t123', 'Ficticia\n123', '12345678'):
            for url, datos, metodo in self.destinos():
                with self.subTest(url=url), s.transaction.atomic():
                    self.c = self.f.login('super')
                    r = self.enviar(url, dict(datos, password=valor), metodo)
                    self.assertEqual(r.status_code, 200 if metodo == 'patch' else 201, r.content)
                    usuario = s.Usuario.objects.get(usuario=datos.get('usuario', 'ficticio_A'))
                    self.assertNotEqual(usuario.password, valor)
                    self.assertTrue(s.check_password(valor, usuario.password))
                    self.assertNotIn('password', r.json())
                    self.assertEqual(self.enviar('/api/auth/login/',
                        {'usuario': usuario.usuario, 'password': valor}).status_code, 200)
                    s.transaction.set_rollback(True)

    def test_limites_vigentes(self):
        for clase in (AdministradorEntradaSerializer, ProfesionalSerializer):
            campo = clase().fields['password']
            with self.assertRaises(serializers.ValidationError):
                campo.run_validation('1234567')
            self.assertEqual(campo.run_validation('12345678'), '12345678')
            self.assertEqual(campo.run_validation('X'*128), 'X'*128)
        with self.assertRaises(serializers.ValidationError):
            AdministradorEntradaSerializer().fields['password'].run_validation('X'*129)
        self.assertEqual(ProfesionalSerializer().fields['password'].run_validation('X'*129), 'X'*129)
        self.assertEqual(CambiarPasswordSerializer().fields['password_nueva'].run_validation('X'*129), 'X'*129)

    def test_cambio_propio_valida_y_no_altera_ante_error(self):
        c = self.f.login('A')
        for nueva in (' Ficticia123', 'Ficticia123 ', '\tFicticia123', 'Ficticia123\n', '1234567'):
            antes = self.f.snapshot()
            r = self.enviar('/api/auth/cambiar-password/',
                {'password_actual': self.f.password, 'password_nueva': nueva}, cliente=c)
            self.assertEqual(r.status_code, 400, r.content)
            self.assertIn('password_nueva', r.json())
            self.assertEqual(self.f.snapshot(), antes)
        r = self.enviar('/api/auth/cambiar-password/',
            {'password_actual': self.f.password, 'password_nueva':'Nueva Ficticia123'}, cliente=c)
        self.assertEqual(r.status_code, 200, r.content)
        self.f.usuarios['A'].refresh_from_db()
        self.assertTrue(s.check_password('Nueva Ficticia123', self.f.usuarios['A'].password))

    def test_cambio_exige_actual_y_diferente(self):
        contexto = {'request': SimpleNamespace(user=self.f.usuarios['A'])}
        for actual, nueva in [('Incorrecta', 'Nueva123'), (self.f.password, self.f.password)]:
            serializer = CambiarPasswordSerializer(data={'password_actual':actual, 'password_nueva':nueva}, context=contexto)
            self.assertFalse(serializer.is_valid())

    def test_compatibilidad_login_exacto_y_recorte_historico(self):
        # El antiguo CharField recortaba ANTES de guardar y antes de autenticar.
        anterior = serializers.CharField().run_validation('  Historica Ficticia123\t')
        usuario = self.f.usuarios['A']
        usuario.password = s.make_password(anterior)
        usuario.save(update_fields=['password'])
        original = usuario.password
        for entrada in ('Historica Ficticia123', '  Historica Ficticia123\t'):
            r = self.enviar('/api/auth/login/', {'usuario':usuario.usuario,'password':entrada})
            self.assertEqual(r.status_code, 200, r.content)
        usuario.refresh_from_db()
        self.assertEqual(usuario.password, original)
        self.assertEqual(LoginSerializer().fields['password'].run_validation(' Clave123 '), 'Clave123')

    def test_no_se_agrega_autenticacion_raw_al_login(self):
        usuario = self.f.usuarios['A']
        usuario.password = s.make_password(' Historica123 ')
        usuario.save(update_fields=['password'])
        for entrada in (' Historica123 ', 'Historica123'):
            r = self.enviar('/api/auth/login/', {'usuario':usuario.usuario,'password':entrada})
            self.assertEqual(r.status_code, 400, r.content)

    def test_error_generico_inexistente_inactivo_o_clave_incorrecta(self):
        inactivo = self.f.usuarios['B']
        inactivo.activo = False
        inactivo.save(update_fields=['activo'])
        respuestas = []
        for nombre, clave in [('inexistente', 'Incorrecta123'), ('ficticio_A','Incorrecta123'),
                              ('ficticio_B',self.f.password)]:
            r = self.enviar('/api/auth/login/', {'usuario':nombre,'password':clave})
            self.assertEqual(r.status_code, 400)
            respuestas.append(r.json())
            self.assertNotIn(clave, r.content.decode())
        self.assertEqual(respuestas[0], respuestas[1])
        self.assertEqual(respuestas[1], respuestas[2])

    def test_rechazos_no_registran_secretos(self):
        mensajes = []
        class Captura(logging.Handler):
            def emit(self, record):
                mensajes.append(record.getMessage())
        handler = Captura()
        logger = logging.getLogger()
        logger.addHandler(handler)
        try:
            secreto = ' SecretoFicticioH07 '
            for url, datos, metodo in self.destinos():
                r = self.enviar(url, dict(datos, password=secreto), metodo)
                self.assertEqual(r.status_code, 400)
                self.assertNotIn('SecretoFicticioH07', r.content.decode())
            self.assertNotIn('SecretoFicticioH07', '\n'.join(mensajes))
        finally:
            logger.removeHandler(handler)


if __name__ == '__main__':
    unittest.main()
