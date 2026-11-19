"""Rutas reales, SQLite en memoria y mocks; sin configuracion operativa."""
import unittest
from unittest.mock import patch
import test_seguridad_csrf as s
from django.conf import settings
from APIs.validadores import identificador_positivo
assert settings.DATABASES['default']['NAME'] == ':memory:'

class Validaciones5ATests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.c = self.f.login('super')
        self.f.turno.refresh_from_db()

    def rutas(self):
        return [('post', f'/api/profesionales/pacientes/{self.f.pacientes["B"].pk}/reasignar/', 'profesional_id'),
                ('patch', f'/api/turnos/{self.f.turno.pk}/estado/', 'ID_EstadoTurno')]

    def enviar(self, ruta, valor, cliente=None):
        metodo, url, campo = ruta
        c = cliente or self.c
        return getattr(c, metodo)(url, {campo: valor}, content_type='application/json',
                                 HTTP_X_CSRFTOKEN=self.f.token(c))

    def test_identificadores_invalidos_400_sin_escrituras(self):
        antes = self.f.snapshot()
        for ruta in self.rutas():
            for valor in [True, False, 1.9, 1.0, '1.9', 0, -1, '\u00b2', None, '',
                          2147483648, '2147483648', '9'*5000, ' 1', '+1', '1_0', [], {}]:
                with self.subTest(ruta=ruta[2], valor=str(valor)[:30]):
                    r = self.enviar(ruta, valor)
                    self.assertEqual(r.status_code, 400, r.content)
                    self.assertIn(ruta[2], r.json())
        self.assertEqual(antes, self.f.snapshot())

    def test_identificadores_validos_llegan_enteros_al_servicio(self):
        from APIs.turnos.services.turno_service import TurnoService
        resultado = dict(turnos_ids=[], profesional_anterior=self.f.profesionales['B'],
                         profesional_nuevo=self.f.profesionales['A'])
        for valor in [1, '1', '\u0661', '\uff11', 2147483647, '2147483647']:
            with self.subTest(valor=valor), patch.object(TurnoService, 'reasignar_paciente', return_value=resultado) as reasignar, patch.object(TurnoService, 'obtener_turnos_reasignados', return_value=[]), patch.object(TurnoService, 'cambiar_estado_turno', return_value=self.f.turno) as cambiar:
                for ruta in self.rutas():
                    self.assertEqual(self.enviar(ruta, valor).status_code, 200)
                esperado = identificador_positivo(valor)
                self.assertEqual(reasignar.call_args.kwargs['profesional_destino_id'], esperado)
                self.assertEqual(cambiar.call_args.kwargs['estado_id'], esperado)

    def test_permisos_reales_con_identificadores_validos(self):
        for actor in ['otro', 'A']:
            c = self.f.login(actor)
            for ruta in self.rutas():
                valor = self.f.profesionales['A'].pk if ruta[2]=='profesional_id' else self.f.estados_turno['Confirmado'].pk
                r = self.enviar(ruta, valor, c)
                self.assertEqual(r.status_code, 400, r.content)

    def test_rangos_pendientes_y_resultados_autorizados(self):
        c = self.f.login('B')
        fecha = self.f.turno_sesion.fecha.isoformat()
        for filtros in [{}, {'fecha_desde':fecha}, {'fecha_hasta':fecha},
                        {'fecha_desde':fecha,'fecha_hasta':fecha},
                        {'fecha_desde':'2000-01-01','fecha_hasta':'2099-01-01'}]:
            r=c.get('/api/sesiones/pendientes/', filtros)
            self.assertEqual(r.status_code,200,r.content)
            self.assertIn(self.f.turno_sesion.pk, [x['id'] for x in r.json()])
            self.assertTrue(all(x['paciente']['id']==self.f.pacientes['B'].pk for x in r.json()))
        for filtros in [{'fecha_desde':'2026-11-20','fecha_hasta':'2026-11-01'},
                        {'fecha_desde':'2026-02-30'}, {'fecha_hasta':'no-fecha'}]:
            r=c.get('/api/sesiones/pendientes/',filtros)
            self.assertEqual(r.status_code,400,r.content)
        self.assertEqual(self.f.login('otro').get('/api/sesiones/pendientes/').status_code,403)

    def test_trabajo_reportes_limites_y_contenido_clinico(self):
        for n, codigo in [(199,200),(200,200),(201,400)]:
            r=self.c.get('/api/reportes/turnos/',{'trabajo_sesion':'x'*n})
            self.assertEqual(r.status_code,codigo,r.content)
        r=self.c.get('/api/reportes/turnos/',{'trabajo_sesion':'Trabajo ficticio'})
        self.assertEqual(r.status_code,200,r.content)
        self.assertGreater(r.json()['total'],0)
        from APIs.sesiones.serializers.sesiones_serializers import RegistroSesionEntradaSerializer
        serializer=RegistroSesionEntradaSerializer(data={'turno_id':self.f.turno_sesion.pk,'trabajo_sesion':'x'*201,'diagnostico':'Ficticio'})
        self.assertTrue(serializer.is_valid(),serializer.errors)

if __name__ == '__main__':
    unittest.main()
