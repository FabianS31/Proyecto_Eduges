"""H07: API real, datos sintéticos, SQLite en memoria; sin configuración externa."""
import unittest
from datetime import timedelta
from unittest.mock import patch
import test_seguridad_csrf as s
from django.utils import timezone
from django.test.utils import CaptureQueriesContext
from django.db import connection


class HistorialTests(unittest.TestCase):
    def test_identificador_conserva_conversion_sin_consultar_existencia(self):
        from rest_framework import serializers
        from APIs.sesiones.serializers.sesiones_serializers import IdentificadorTurnoField
        anterior = serializers.PrimaryKeyRelatedField(queryset=s.Turno.objects.all())
        actual = IdentificadorTurnoField(queryset=s.Turno.objects.all())
        pk = self.turno.pk
        for valor in (pk, str(pk), float(pk), pk + 0.5, f' {pk} ',
                      f'{pk}.0', True, False, [], {}, None, 'invalido'):
            with self.subTest(valor=valor):
                try:
                    esperado = anterior.run_validation(valor).pk
                except serializers.ValidationError as error:
                    with self.assertRaises(serializers.ValidationError) as nuevo:
                        actual.run_validation(valor)
                    self.assertEqual(nuevo.exception.detail, error.detail)
                else:
                    with CaptureQueriesContext(connection) as consultas:
                        self.assertEqual(actual.run_validation(valor), esperado)
                    self.assertEqual(len(consultas), 0)

    def pedir(self, cliente, metodo, turno_id, datos=None):
        url = '/api/sesiones/' if metodo == 'post' else f'/api/sesiones/{turno_id}/'
        if metodo == 'get':
            return cliente.get(url)
        cuerpo = {'trabajo_sesion': 'Trabajo sintético',
                  'diagnostico': 'Diagnóstico sintético', 'nota_sesion': 'Nota sintética'}
        if datos is not None:
            cuerpo = datos.copy()
        if metodo == 'post':
            cuerpo['turno_id'] = turno_id
        return getattr(cliente, metodo)(url, cuerpo, content_type='application/json',
                                       HTTP_X_CSRFTOKEN=self.f.token(cliente))

    def comprobar_denegacion_uniforme(self, actor, metodos):
        cliente = self.f.login(actor)
        ausente = s.EstadoTurno.objects.create(estado='Ausente')
        for estado in (*self.f.estados_turno.values(), ausente):
            self.f.turno.estado = estado
            self.f.turno.save(update_fields=['estado'])
            antes = self.f.snapshot()
            for metodo in metodos:
                respuestas = [self.pedir(cliente, metodo, pk) for pk in (
                    self.turno.pk, self.f.turno.pk, self.f.turno_sesion.pk, 999999)]
                for respuesta in respuestas:
                    self.assertEqual(respuesta.status_code, 403)
                    self.assertEqual(respuesta.content, respuestas[0].content)
                    self.assertEqual(set(respuesta.json()), {'detail'})
                    self.assertIn('no-store', respuesta['Cache-Control'])
                    for privado in (self.f.registro.trabajo_sesion,
                                    self.f.registro.diagnostico, 'NOTA PRIVADA B'):
                        self.assertNotIn(privado, respuesta.content.decode())
            self.assertEqual(self.f.snapshot(), antes)

    def test_ajeno_no_distingue_existencia_ni_estado_en_get_post_patch(self):
        self.comprobar_denegacion_uniforme('A', ('get', 'post', 'patch'))

    def test_administrador_no_distingue_existencia_en_escrituras(self):
        self.comprobar_denegacion_uniforme('admin', ('post', 'patch'))

    def test_sin_vinculo_y_rol_ajeno_no_distinguen_existencia(self):
        for actor in ('sin_vinculo', 'otro'):
            self.comprobar_denegacion_uniforme(actor, ('get', 'post', 'patch'))

    def test_nuevo_asignado_lee_resumen_pero_no_infiere_por_escrituras(self):
        self.asignar_a()
        self.comprobar_resumen(self.historial('A'))
        self.assertEqual(set(self.detalle('A').json()), {'id', 'diagnostico'})
        self.comprobar_denegacion_uniforme('A', ('post', 'patch'))

    def test_anonimo_no_distingue_existencia_ni_escribe(self):
        cliente = s.Client()
        antes = self.f.snapshot()
        for metodo in ('get', 'post', 'patch'):
            respuestas = []
            for pk in (self.turno.pk, self.f.turno.pk, 999999):
                url = '/api/sesiones/' if metodo == 'post' else f'/api/sesiones/{pk}/'
                respuesta = getattr(cliente, metodo)(url, {'turno_id': pk},
                                                      content_type='application/json')
                self.assertEqual(respuesta.status_code, 401)
                self.assertIn('no-store', respuesta['Cache-Control'])
                self.assertEqual(set(respuesta.json()), {'detail'})
                respuestas.append(respuesta.content)
            self.assertEqual(len(set(respuestas)), 1)
        self.assertEqual(self.f.snapshot(), antes)

    def test_autorizados_conservan_mensajes_sin_sesion_y_validaciones(self):
        self.asignar_a()
        for actor in ('A', 'B', 'admin', 'super'):
            respuesta = self.pedir(self.f.login(actor), 'get', self.f.turno.pk)
            self.assertEqual(respuesta.status_code, 404)
            self.assertEqual(respuesta.json(), {
                'detail': 'Este turno todavía no tiene un registro de sesión.'})
        for actor in ('B', 'super'):
            cliente = self.f.login(actor)
            antes = self.f.snapshot()
            respuesta = self.pedir(cliente, 'post', self.turno.pk)
            self.assertEqual(respuesta.status_code, 400)
            self.assertIn('ya tiene un registro', respuesta.json()['turno_id'])
            respuesta = self.pedir(cliente, 'patch', self.f.turno.pk)
            self.assertEqual(respuesta.status_code, 404)
            self.assertIn('todavía no tiene', respuesta.json()['detail'])
            respuesta = self.pedir(cliente, 'post', self.f.turno.pk)
            self.assertEqual(respuesta.status_code, 400)
            self.assertIn('Confirmado iniciado o Realizado', respuesta.json()['turno_id'])
            self.assertEqual(self.f.snapshot(), antes)

    def test_super_conserva_creacion_edicion_y_contenido_completo(self):
        cliente = self.f.login('super')
        respuesta = self.pedir(cliente, 'post', self.f.turno_sesion.pk)
        self.assertEqual(respuesta.status_code, 201)
        self.assertEqual(set(respuesta.json()), {
            'id', 'descripcion', 'trabajo_sesion', 'diagnostico', 'nota_sesion', 'mensaje'})
        self.assertEqual(respuesta.json()['descripcion'],
                         f'Registro clínico correspondiente al turno {self.f.turno_sesion.pk}')
        self.assertEqual(respuesta.json()['nota_sesion'], 'Nota sintética')
        respuesta = self.pedir(cliente, 'patch', self.turno.pk, {'nota_sesion': 'Nota técnica'})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json(), {
            'id': self.f.registro.pk, 'trabajo_sesion': self.f.registro.trabajo_sesion,
            'diagnostico': self.f.registro.diagnostico, 'nota_sesion': 'Nota técnica'})
        self.assertEqual(self.detalle('super').json(), respuesta.json())
        antes = self.f.snapshot()
        respuesta = self.pedir(cliente, 'patch', self.turno.pk, {'profesional_id': 999999})
        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(self.f.snapshot(), antes)

    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['ENGINE'] == 'django.db.backends.sqlite3'
        assert connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.paciente = self.f.pacientes['B']
        self.turno = self.f.turno_registrado
        self.f.registro.nota_sesion = 'NOTA PRIVADA B'
        self.f.registro.save(update_fields=['nota_sesion'])

    def historial(self, actor='A', paciente=None):
        return self.f.login(actor).get('/api/sesiones/', {
            'paciente_id': self.paciente.pk if paciente is None else paciente})

    def detalle(self, actor):
        return self.f.login(actor).get(f'/api/sesiones/{self.turno.pk}/')

    def asignar_a(self, inicio=None):
        s.AsignacionProfesional.objects.filter(paciente=self.paciente).update(fecha_fin=timezone.localdate())
        return s.AsignacionProfesional.objects.create(
            paciente=self.paciente, profesional=self.f.profesionales['A'],
            fecha_inicio=inicio or timezone.localdate())

    def comprobar_resumen(self, respuesta):
        self.assertEqual(respuesta.status_code, 200, respuesta.content)
        self.assertEqual(len(respuesta.json()), 1)
        fila = respuesta.json()[0]
        self.assertEqual(set(fila), {'turno_id', 'fecha', 'hora', 'profesional', 'sesion'})
        self.assertEqual(set(fila['sesion']), {'id', 'diagnostico'})
        self.assertEqual(fila['profesional']['id'], self.f.profesionales['B'].pk)
        self.assertEqual(fila['sesion']['diagnostico'], self.f.registro.diagnostico)
        self.assertNotIn('NOTA PRIVADA B', respuesta.content.decode())
        self.assertNotIn(self.f.registro.trabajo_sesion, respuesta.content.decode())
        self.assertIn('no-store', respuesta['Cache-Control'])

    def test_nuevo_responsable_solo_diagnostico_y_autor_conserva_detalle(self):
        self.asignar_a()
        self.comprobar_resumen(self.historial())
        self.assertEqual(set(self.detalle('A').json()), {'id', 'diagnostico'})
        propio = self.detalle('B')
        self.assertEqual(propio.status_code, 200)
        self.assertEqual(propio.json()['nota_sesion'], 'NOTA PRIVADA B')
        self.assertEqual(propio.json()['trabajo_sesion'], self.f.registro.trabajo_sesion)
        self.assertIn('no-store', propio['Cache-Control'])
        self.assertEqual(self.historial('B').status_code, 403)

    def test_paciente_ajeno_no_se_consultan_registros(self):
        client = self.f.login('A')
        with CaptureQueriesContext(connection) as consultas:
            r = client.get('/api/sesiones/', {'paciente_id': self.paciente.pk})
        self.assertEqual(r.status_code, 403)
        self.assertFalse(any('registros_de_sesiones' in q['sql'].lower() for q in consultas))
        self.assertEqual(self.detalle('A').status_code, 403)

    def test_revocacion_en_misma_sesion_http(self):
        asignacion = self.asignar_a()
        client = self.f.login('A')
        url = '/api/sesiones/'
        self.assertEqual(client.get(url, {'paciente_id': self.paciente.pk}).status_code, 200)
        asignacion.fecha_fin = timezone.localdate()
        asignacion.save(update_fields=['fecha_fin'])
        self.assertEqual(client.get(url, {'paciente_id': self.paciente.pk}).status_code, 403)
        self.assertEqual(client.get(f'/api/sesiones/{self.turno.pk}/').status_code, 403)
        self.assertEqual(self.detalle('B').status_code, 200)

    def test_asignacion_futura_no_habilita_historial_ni_detalle_ajeno(self):
        self.asignar_a(timezone.localdate() + timedelta(days=1))
        self.assertEqual(self.historial().status_code, 403)
        self.assertEqual(self.detalle('A').status_code, 403)
        self.assertEqual(self.detalle('B').status_code, 200)

    def test_administrador_resumen_y_tecnico_sin_ampliar_respuesta_historial(self):
        for actor in ('admin', 'super'):
            self.comprobar_resumen(self.historial(actor))
        self.assertEqual(set(self.detalle('admin').json()), {'id', 'diagnostico'})
        self.assertIn('trabajo_sesion', self.detalle('super').json())

    def test_mismo_dia_y_mas_de_diez_sesiones_sin_turnos_falsos(self):
        self.asignar_a()
        self.turno.fecha = timezone.localdate()
        self.turno.save(update_fields=['fecha'])
        ids = [self.turno.pk]
        for indice in range(12):
            registro = s.RegistroSesion.objects.create(
                diagnostico=f'Diagnóstico sintético {indice}', trabajo_sesion='PRIVADO', nota_sesion='PRIVADO')
            ids.append(s.Turno.objects.create(
                paciente=self.paciente, profesional=self.f.profesionales['B'],
                fecha=timezone.localdate(), hora='09:00',
                estado=self.f.estados_turno['Realizado'], registro_sesion=registro).pk)
        r = self.historial()
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([fila['turno_id'] for fila in r.json()], list(reversed(ids)))
        self.assertNotIn(self.f.turno.pk, ids)
        self.assertNotIn(self.f.turno_sesion.pk, ids)
        self.assertNotIn('PRIVADO', r.content.decode())

    def test_historial_vacio_autorizado(self):
        r = self.historial('A', self.f.pacientes['A'].pk)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), [])

    def test_identificadores_invalidos_manipulados_y_roles(self):
        client = self.f.login('A')
        for datos in ({}, {'paciente_id': ''}, {'paciente_id': -1}, {'paciente_id': 'abc'}):
            self.assertEqual(client.get('/api/sesiones/', datos).status_code, 400)
        for paciente in (self.paciente.pk, 999999):
            self.assertEqual(self.historial('A', paciente).status_code, 403)
        self.assertEqual(self.historial('admin', 999999).status_code, 404)
        for actor in ('otro', 'sin_vinculo'):
            self.assertEqual(self.historial(actor).status_code, 403)
        self.assertEqual(s.Client().get('/api/sesiones/', {'paciente_id': self.paciente.pk}).status_code, 401)

    def test_post_y_patch_propios_siguen_funcionando(self):
        client = self.f.login('B')
        datos = {'turno_id': self.f.turno_sesion.pk, 'trabajo_sesion': 'Trabajo nuevo',
                 'diagnostico': 'Diagnóstico nuevo', 'nota_sesion': 'Nota nueva'}
        r = client.post('/api/sesiones/', datos, content_type='application/json',
                        HTTP_X_CSRFTOKEN=self.f.token(client))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['trabajo_sesion'], datos['trabajo_sesion'])
        self.asignar_a()
        r = client.patch(f'/api/sesiones/{self.turno.pk}/', {'nota_sesion': 'Actualizada'},
                         content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(client))
        self.assertEqual(r.status_code, 200, r.content)

    def test_historial_no_habilita_escritura_ajena(self):
        self.asignar_a()
        for actor in ('A', 'admin'):
            client = self.f.login(actor)
            antes = self.f.snapshot()
            r = client.patch(f'/api/sesiones/{self.turno.pk}/', {'diagnostico': 'No guardar'},
                             content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(client))
            self.assertEqual(r.status_code, 403)
            self.assertEqual(self.f.snapshot(), antes)


if __name__ == '__main__':
    import socket
    with patch.object(socket.socket, 'connect', side_effect=RuntimeError('Red prohibida')):
        unittest.main()
