"""H07: API real, datos sintéticos, SQLite en memoria; sin configuración externa."""
import unittest
from datetime import timedelta
from unittest.mock import patch
import test_seguridad_csrf as s
from django.utils import timezone
from django.test.utils import CaptureQueriesContext
from django.db import connection


class HistorialTests(unittest.TestCase):
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
