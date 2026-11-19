"""H12: API real, datos ficticios, reloj simulado y SQLite exclusivamente en memoria."""
import unittest
from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo
from unittest.mock import patch
from django.test import override_settings
import test_seguridad_csrf as s
from APIs.turnos.services.turno_service import TurnoService
from rest_framework.exceptions import ValidationError


class TemporalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.ahora=datetime(2027,3,1,12,tzinfo=ZoneInfo('America/Argentina/Buenos_Aires'))
        reloj=patch.object(s.timezone,'now',return_value=self.ahora)
        reloj.start(); self.addCleanup(reloj.stop)
        self.f=s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups); self.f.setUp()
        self.clientes={actor:self.f.login(actor) for actor in ('B','A','admin','super','otro')}
        self.url=f'/api/turnos/{self.f.turno.pk}/'
        self.ausente=s.EstadoTurno.objects.create(estado='Ausente')

    def original(self, segundos=600, estado='Pendiente', sesion=False):
        inicio=self.ahora+timedelta(seconds=segundos)
        s.Turno.objects.filter(pk=self.f.turno.pk).update(fecha=inicio.date(),hora=inicio.time(),
            estado=self.f.estados_turno.get(estado,self.ausente),
            registro_sesion=self.f.registro if sesion else None)
        self.f.turno.refresh_from_db()

    def enviar(self, actor, ruta, datos=None):
        cliente=self.clientes[actor]
        metodo='delete' if ruta=='delete' else ('put' if ruta=='put' else 'patch')
        url=self.url+('estado/' if ruta=='estado' else '')
        if datos is None:
            datos={'ID_EstadoTurno':self.f.estados_turno['Cancelado'].pk} if ruta=='estado' else (
                {'fecha':'2027-03-04','hora':'18:00','paciente':self.f.pacientes['B'].pk} if ruta in ('patch','put') else {})
        return getattr(cliente,metodo)(url,datos,content_type='application/json',
            HTTP_X_CSRFTOKEN=self.f.token(cliente))

    def test_cancelaciones_limites_roles_estados_y_api_directa(self):
        for actor in ('B','admin','super'):
            for estado in ('Pendiente','Confirmado'):
                for segundos in (172800,600,1,0,-1,-86400):
                    for ruta in ('delete','estado'):
                        with self.subTest(actor=actor,estado=estado,segundos=segundos,ruta=ruta),s.transaction.atomic():
                            self.original(segundos,estado); antes=self.f.snapshot()
                            r=self.enviar(actor,ruta)
                            self.assertEqual(r.status_code,200 if segundos>0 else 400,r.content)
                            if segundos<=0:
                                self.assertIn('hora de inicio',r.json()['detail'])
                                self.assertEqual(self.f.snapshot(),antes)
                            else:
                                self.f.turno.refresh_from_db()
                                self.assertEqual(self.f.turno.estado.estado,'Cancelado')
                            s.transaction.set_rollback(True)

    def test_reprogramacion_original_y_destino_por_put_patch(self):
        for actor in ('B','admin','super'):
            for estado in ('Pendiente','Confirmado'):
                for segundos in (600,1,0,-1,-86400):
                    for ruta in ('put','patch'):
                        with self.subTest(actor=actor,estado=estado,segundos=segundos,ruta=ruta),s.transaction.atomic():
                            self.original(segundos,estado); antes=self.f.snapshot()
                            r=self.enviar(actor,ruta)
                            self.assertEqual(r.status_code,200 if segundos>0 else 400,r.content)
                            if segundos<=0: self.assertEqual(self.f.snapshot(),antes)
                            else:
                                self.f.turno.refresh_from_db()
                                self.assertEqual(str(self.f.turno.fecha),'2027-03-04')
                                self.assertEqual(self.f.turno.estado.estado,estado)
                            s.transaction.set_rollback(True)

    def test_permisos_no_se_amplian(self):
        self.original()
        antes=self.f.snapshot()
        for actor in ('A','otro'):
            for ruta in ('delete','estado','patch','put'):
                r=self.enviar(actor,ruta)
                self.assertIn(r.status_code,(400,403),r.content)
        self.assertEqual(self.f.snapshot(),antes)

    def test_estados_finales_y_sesion_no_admiten_modificacion(self):
        for estado,sesion in [('Cancelado',False),('Realizado',False),('Ausente',False),('Confirmado',True)]:
            self.original(600,estado,sesion); antes=self.f.snapshot()
            for ruta in ('delete','estado','patch'):
                self.assertEqual(self.enviar('super',ruta).status_code,400)
                self.assertEqual(self.f.snapshot(),antes)

    def test_destino_invalido_y_solapado_no_escribe(self):
        self.original(); antes=self.f.snapshot()
        for datos in ({'fecha':'2027-02-28','hora':'18:00'},
                      {'fecha':'2028-03-02','hora':'18:00'},
                      {'fecha':'2027-03-01','hora':'11:59'}):
            self.assertEqual(self.enviar('B','patch',datos).status_code,400)
            self.assertEqual(self.f.snapshot(),antes)
        s.Turno.objects.create(paciente=self.f.pacientes['B'],profesional=self.f.profesionales['B'],
            fecha='2027-03-04',hora='18:20',estado=self.f.estados_turno['Pendiente'])
        antes=self.f.snapshot()
        self.assertEqual(self.enviar('B','patch').status_code,400)
        self.assertEqual(self.f.snapshot(),antes)

    def test_asistencia_conserva_inicio_y_cuarenta_minutos(self):
        self.original(0,'Confirmado')
        self.assertEqual(self.enviar('B','estado',{'ID_EstadoTurno':self.ausente.pk}).status_code,200)
        antes=self.f.snapshot()
        self.assertEqual(self.enviar('B','estado',{'ID_EstadoTurno':self.f.estados_turno['Realizado'].pk}).status_code,400)
        self.assertEqual(self.f.snapshot(),antes)
        self.original(-2400,'Confirmado')
        self.assertEqual(self.enviar('B','estado',{'ID_EstadoTurno':self.f.estados_turno['Realizado'].pk}).status_code,200)

    def test_zona_institucional_cambio_de_dia_y_configuracion_naive(self):
        self.original(1)
        for zona in ('UTC','Asia/Tokyo','America/Los_Angeles'):
            with s.timezone.override(zona):
                TurnoService.validar_original_no_iniciado(self.f.turno)
                self.assertEqual(TurnoService.inicio_institucional(self.f.turno).utcoffset(),timedelta(hours=-3))
        inicio=datetime(2027,3,2,0,0,tzinfo=ZoneInfo('America/Argentina/Buenos_Aires'))
        s.Turno.objects.filter(pk=self.f.turno.pk).update(fecha=inicio.date(),hora=inicio.time())
        self.f.turno.refresh_from_db()
        for delta in (-1,0,1):
            with patch.object(s.timezone,'now',return_value=(inicio+timedelta(seconds=delta)).astimezone(dt_timezone.utc)):
                if delta<0: TurnoService.validar_original_no_iniciado(self.f.turno)
                else:
                    with self.assertRaises(ValidationError): TurnoService.validar_original_no_iniciado(self.f.turno)
        with override_settings(USE_TZ=False),patch.object(s.timezone,'now',return_value=inicio.replace(tzinfo=None)):
            with self.assertRaises(ValidationError): TurnoService.validar_original_no_iniciado(self.f.turno)

    def test_lista_incluye_referencia_servidor_sin_mutacion(self):
        self.original(1); antes=self.f.snapshot()
        r=self.clientes['B'].get('/api/turnos/')
        self.assertEqual(r.status_code,200)
        t=next(t for t in r.json() if t['id_turno']==self.f.turno.pk)
        self.assertEqual(datetime.fromisoformat(t['ventana_modificacion']['ahora']),self.ahora)
        self.assertEqual(datetime.fromisoformat(t['ventana_modificacion']['inicio']),self.ahora+timedelta(seconds=1))
        self.assertEqual(self.f.snapshot(),antes)

    def test_revalidacion_despues_de_validar_destino(self):
        self.original(1); antes=self.f.snapshot()
        def avanzar(*args,**kwargs):
            s.timezone.now.return_value=self.ahora+timedelta(seconds=1)
        with patch.object(TurnoService,'validar_solapamiento',side_effect=avanzar):
            r=self.enviar('B','patch')
        self.assertEqual(r.status_code,400,r.content)
        self.assertEqual(self.f.snapshot(),antes)

    def test_bajas_y_reasignacion_no_usan_prohibicion_individual(self):
        casos=[
            ('patch',f'/api/pacientes/{self.f.pacientes["B"].pk}/estado/',{'estado':'Inactivo'},'Cancelado'),
            ('patch',f'/api/profesionales/{self.f.profesionales["B"].pk}/estado/',{'estado':'Inactivo'},'Cancelado'),
            ('post',f'/api/profesionales/pacientes/{self.f.pacientes["B"].pk}/reasignar/',
             {'profesional_id':self.f.profesionales['A'].pk},'Pendiente'),
        ]
        for metodo,url,datos,estado in casos:
            with self.subTest(url=url),s.transaction.atomic(),patch.object(
                    TurnoService,'validar_original_no_iniciado',side_effect=AssertionError('Control individual fuera de alcance')):
                self.original(600)
                cliente=self.clientes['B' if metodo=='post' else 'super']
                r=getattr(cliente,metodo)(url,datos,content_type='application/json',HTTP_X_CSRFTOKEN=self.f.token(cliente))
                self.assertEqual(r.status_code,200,r.content)
                self.f.turno.refresh_from_db()
                self.assertEqual(self.f.turno.estado.estado,estado)
                if estado=='Pendiente': self.assertEqual(self.f.turno.profesional_id,self.f.profesionales['A'].pk)
                s.transaction.set_rollback(True)


if __name__=='__main__': unittest.main()
