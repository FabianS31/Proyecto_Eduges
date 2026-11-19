"""H11: reloj fijo, API real y SQLite en memoria; sin configuracion operativa."""
import unittest
from datetime import date, datetime, time, timedelta
from unittest.mock import patch
import test_seguridad_csrf as s
from APIs.turnos.services.turno_service import TurnoService
from rest_framework.exceptions import ValidationError


class VentanasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        reloj = patch.object(s.timezone, 'now', return_value=s.timezone.make_aware(datetime(2027, 3, 1, 12)))
        reloj.start()
        self.addCleanup(reloj.stop)
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.c = self.f.login('B')

    def enviar(self, datos, url='/api/turnos/', metodo='post'):
        return getattr(self.c, metodo)(url, datos, content_type='application/json',
                                      HTTP_X_CSRFTOKEN=self.f.token(self.c))

    def datos(self, fecha, hora='16:00'):
        return {'paciente': self.f.pacientes['B'].pk, 'fecha': fecha, 'hora': hora}

    def test_matriz_calendario_igual_a_frontend(self):
        for referencia, limite in [(date(2026,11,18),date(2027,11,18)),
                                   (date(2027,3,1),date(2028,3,1)),
                                   (date(2028,2,29),date(2029,2,28)),
                                   (date(2027,2,28),date(2028,2,28))]:
            with self.subTest(referencia=referencia), patch.object(s.timezone,'now',return_value=s.timezone.make_aware(datetime.combine(referencia,time(12)))):
                TurnoService.validar_fecha_hora(limite,time(16))
                with self.assertRaises(ValidationError):
                    TurnoService.validar_fecha_hora(limite+timedelta(days=1),time(16))

    def test_series_52_semanas_completas_o_ninguna_escritura(self):
        for inicio, codigo in [(date(2027,3,2),201),(date(2027,3,11),400),(date(2027,4,1),400)]:
            with self.subTest(inicio=inicio), s.transaction.atomic():
                fechas=[inicio+timedelta(weeks=i) for i in range(52)]
                datos={'paciente':self.f.pacientes['B'].pk,
                       'turnos':[{'fecha':f.isoformat(),'hora':'16:00'} for f in fechas]}
                antes=self.f.snapshot()
                r=self.enviar(datos)
                self.assertEqual(r.status_code,codigo,r.content)
                if codigo==400:
                    self.assertEqual(self.f.snapshot(),antes)
                else:
                    self.assertEqual(r.json()['cantidad'],52)
                    self.assertEqual(s.Turno.objects.count(),len(antes['turnos.Turno'])+52)
                s.transaction.set_rollback(True)

    def test_individual_reprogramacion_limite_y_40_minutos(self):
        r=self.enviar(self.datos('2028-03-01'))
        self.assertEqual(r.status_code,201,r.content)
        r=self.enviar(self.datos('2028-03-01','16:40'))
        self.assertEqual(r.status_code,201,r.content)
        antes=self.f.snapshot()
        self.assertEqual(self.enviar(self.datos('2028-03-01','16:39')).status_code,400)
        self.assertEqual(self.enviar(self.datos('2028-03-02')).status_code,400)
        self.assertEqual(self.f.snapshot(),antes)
        url=f'/api/turnos/{self.f.turno.pk}/'
        r=self.enviar({'fecha':'2028-03-01','hora':'18:00'},url,'patch')
        self.assertEqual(r.status_code,200,r.content)
        antes=self.f.snapshot()
        self.assertEqual(self.enviar({'fecha':'2028-03-02','hora':'18:00'},url,'patch').status_code,400)
        self.assertEqual(self.f.snapshot(),antes)

    def test_fechas_horarios_invalidos_y_pasados(self):
        antes=self.f.snapshot()
        for fecha,hora in [('2027-02-30','16:00'),('invalida','16:00'),
                           ('2027-03-02','25:00'),('2027-03-02','12:99'),
                           ('2027-03-01','12:00'),('2027-02-28','16:00')]:
            with self.subTest(fecha=fecha,hora=hora):
                self.assertEqual(self.enviar(self.datos(fecha,hora)).status_code,400)
        self.assertEqual(self.f.snapshot(),antes)


if __name__ == '__main__':
    unittest.main()
