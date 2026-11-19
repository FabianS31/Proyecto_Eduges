"""H01: API real y SQLite en memoria; sin configuración ni bases operativas."""
import unittest
from datetime import date, datetime, time, timedelta
from unittest.mock import patch
import test_seguridad_csrf as s
from APIs.turnos.services.turno_service import TurnoService
from rest_framework.exceptions import ValidationError


class SolapamientosTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        reloj = patch.object(s.timezone, 'now', return_value=s.timezone.make_aware(datetime(2026, 11, 1, 12)))
        reloj.start()
        self.addCleanup(reloj.stop)
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.lunes = date(2026, 11, 2)
        self.martes = self.lunes + timedelta(days=1)
        self.cliente = self.f.login('B')

    def enviar(self, datos, url='/api/turnos/', metodo='post'):
        return getattr(self.cliente, metodo)(url, datos, content_type='application/json',
            HTTP_X_CSRFTOKEN=self.f.token(self.cliente))

    def datos(self, fecha, hora):
        return {'paciente': self.f.pacientes['B'].pk, 'fecha': fecha.isoformat(), 'hora': hora}

    def existente(self, fecha, hora, profesional='B', paciente='B', estado='Pendiente'):
        estado_obj, _ = s.EstadoTurno.objects.get_or_create(estado=estado)
        return s.Turno.objects.create(fecha=fecha, hora=time.fromisoformat(hora),
            profesional=self.f.profesionales[profesional], paciente=self.f.pacientes[paciente], estado=estado_obj)

    def test_intervalos_y_orden_de_creacion_por_api(self):
        for h1, h2, dias, esperado in [
            ('10:00','10:00',0,400), ('10:00','10:39',0,400), ('10:00','10:40',0,201),
            ('23:40','00:00',1,400), ('23:20','00:00',1,201), ('23:59','00:10',1,400),
        ]:
            for invertir in (False, True):
                with self.subTest(h1=h1,h2=h2,invertir=invertir), s.transaction.atomic():
                    primero = self.datos(self.lunes,h1)
                    segundo = self.datos(self.lunes+timedelta(days=dias),h2)
                    if invertir:
                        primero, segundo = segundo, primero
                    r = self.enviar(primero)
                    self.assertEqual(r.status_code,201,r.content)
                    antes = self.f.snapshot()
                    r = self.enviar(segundo)
                    self.assertEqual(r.status_code,esperado,r.content)
                    if esperado == 400:
                        self.assertEqual(self.f.snapshot(),antes)
                        self.assertIn('hora',r.json())
                    s.transaction.set_rollback(True)

    def test_profesional_o_paciente_y_estados(self):
        for profesional,paciente,esperado in [('B','A',400),('A','B',400),('A','A',201)]:
            with self.subTest(profesional=profesional,paciente=paciente), s.transaction.atomic():
                self.existente(self.lunes,'23:40',profesional,paciente)
                self.assertEqual(self.enviar(self.datos(self.martes,'00:00')).status_code,esperado)
                s.transaction.set_rollback(True)
        for estado in ('Pendiente','Confirmado','Ausente','Realizado','Cancelado'):
            with self.subTest(estado=estado), s.transaction.atomic():
                self.existente(self.lunes,'23:40',estado=estado)
                self.assertEqual(self.enviar(self.datos(self.martes,'00:00')).status_code,
                    201 if estado == 'Cancelado' else 400)
                s.transaction.set_rollback(True)

    def test_lote_interno_entre_dias_atomico_y_consecutivos_validos(self):
        for hora, esperado in [('23:40',400),('23:20',201)]:
            with self.subTest(hora=hora), s.transaction.atomic():
                antes = self.f.snapshot()
                datos = {'paciente':self.f.pacientes['B'].pk,'turnos':[
                    {'fecha':self.martes.isoformat(),'hora':'00:00'},
                    {'fecha':self.lunes.isoformat(),'hora':hora}]}
                r = self.enviar(datos)
                self.assertEqual(r.status_code,esperado,r.content)
                if esperado == 400:
                    self.assertIn('turnos',r.json())
                    self.assertEqual(self.f.snapshot(),antes)
                else:
                    self.assertEqual(r.json()['cantidad'],2)
                s.transaction.set_rollback(True)

    def test_anual_52_semanas_conflicto_ultima_fecha_y_exito(self):
        fechas = [self.lunes+timedelta(weeks=i) for i in range(52)]
        choque = self.existente(fechas[-1]+timedelta(days=1),'00:00')
        datos = {'paciente':self.f.pacientes['B'].pk,
            'turnos':[{'fecha':f.isoformat(),'hora':'23:40'} for f in fechas]}
        antes = self.f.snapshot()
        r = self.enviar(datos)
        self.assertEqual(r.status_code,400,r.content)
        self.assertEqual(self.f.snapshot(),antes)
        choque.estado = self.f.estados_turno['Cancelado']
        choque.save(update_fields=['estado'])
        r = self.enviar(datos)
        self.assertEqual(r.status_code,201,r.content)
        self.assertEqual(r.json()['cantidad'],52)

    def test_reprogramacion_exclusion_propia_y_limite_exacto(self):
        turno = self.existente(self.lunes,'23:40')
        url = f'/api/turnos/{turno.pk}/'
        r = self.enviar({'fecha':self.lunes.isoformat(),'hora':'23:40'},url,'patch')
        self.assertEqual(r.status_code,200,r.content)
        self.existente(self.martes,'01:00')
        antes = self.f.snapshot()
        r = self.enviar({'fecha':self.martes.isoformat(),'hora':'00:30'},url,'patch')
        self.assertEqual(r.status_code,400,r.content)
        self.assertEqual(self.f.snapshot(),antes)
        r = self.enviar({'fecha':self.martes.isoformat(),'hora':'00:20'},url,'patch')
        self.assertEqual(r.status_code,200,r.content)

    def test_reprogramacion_conflicto_entre_dias(self):
        self.existente(self.lunes,'23:40')
        antes = self.f.snapshot()
        r = self.enviar({'fecha':self.martes.isoformat(),'hora':'00:00'},
            f'/api/turnos/{self.f.turno.pk}/','patch')
        self.assertEqual(r.status_code,400,r.content)
        self.assertEqual(self.f.snapshot(),antes)

    def test_reasignacion_busca_alternativa_sin_solapar(self):
        turno = self.f.turno
        turno.fecha=self.lunes
        turno.hora=time(23,40)
        turno.save(update_fields=['fecha','hora'])
        self.existente(self.martes,'00:00',profesional='A',paciente='A')
        sesion = s.RegistroSesion.objects.filter(pk=self.f.registro.pk).values().get()
        r = self.enviar({'profesional_id':self.f.profesionales['A'].pk},
            f'/api/profesionales/pacientes/{self.f.pacientes["B"].pk}/reasignar/')
        self.assertEqual(r.status_code,200,r.content)
        turno.refresh_from_db()
        self.assertEqual((turno.fecha,turno.hora),(self.martes,time(9)))
        TurnoService.validar_solapamiento(turno.profesional,turno.paciente,turno.fecha,turno.hora,turno.pk)
        self.assertEqual(s.RegistroSesion.objects.filter(pk=self.f.registro.pk).values().get(),sesion)

    def test_rollback_lote_si_falla_segunda_escritura(self):
        antes = self.f.snapshot()
        crear = s.Turno.objects.create
        n = 0
        def fallar(**datos):
            nonlocal n
            n += 1
            if n == 2:
                raise RuntimeError('fallo ficticio')
            return crear(**datos)
        with patch.object(s.Turno.objects,'create',side_effect=fallar):
            with self.assertRaises(RuntimeError):
                self.enviar({'paciente':self.f.pacientes['B'].pk,'turnos':[
                    {'fecha':self.lunes.isoformat(),'hora':'23:20'},
                    {'fecha':self.martes.isoformat(),'hora':'00:00'}]})
        self.assertEqual(self.f.snapshot(),antes)

    def test_rollback_reasignacion_sin_disponibilidad(self):
        antes = self.f.snapshot()
        with patch.object(TurnoService,'buscar_horario_disponible',side_effect=ValidationError({'turnos':'Sin disponibilidad ficticia'})):
            r = self.enviar({'profesional_id':self.f.profesionales['A'].pk},
                f'/api/profesionales/pacientes/{self.f.pacientes["B"].pk}/reasignar/')
        self.assertEqual(r.status_code,400,r.content)
        self.assertEqual(self.f.snapshot(),antes)

    def test_avisos_conflicto_detectan_dias_adyacentes(self):
        a = self.existente(self.lunes,'23:40')
        b = self.existente(self.martes,'00:00')
        self.assertEqual([c['id_turno'] for c in TurnoService.obtener_conflictos_horario(a)],[b.pk])
        self.assertEqual([c['id_turno'] for c in TurnoService.obtener_conflictos_horario(b)],[a.pk])


if __name__ == '__main__':
    unittest.main()
