"""Etapa 6: rutas reales sobre SQLite en memoria; sin bases externas."""
import unittest
from datetime import date, datetime, timedelta
from unittest.mock import patch
import test_seguridad_csrf as s
from APIs.turnos.services.turno_service import TurnoService
from APIs.sesiones.services.sesiones_services import SesionesService
from rest_framework.exceptions import ValidationError


class AsignacionTemporalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.reloj=patch.object(s.timezone,'now',return_value=s.timezone.make_aware(datetime(2026,11,12,12)))
        self.reloj.start(); self.addCleanup(self.reloj.stop)
        self.f=s.SeguridadCSRFTests(); self.addCleanup(self.f.doCleanups); self.f.setUp()
        self.hoy=s.timezone.localdate()
        self.asignacion=s.AsignacionProfesional.objects.get(paciente=self.f.pacientes['B'])
        self.url=f'/api/turnos/{self.f.turno.pk}/'

    def enviar(self,actor,metodo,url,datos):
        c=self.f.login(actor)
        return getattr(c,metodo)(url,datos,content_type='application/json',HTTP_X_CSRFTOKEN=self.f.token(c))

    def datos(self,dias=3):
        return {'paciente':self.f.pacientes['B'].pk,'profesional':self.f.profesionales['B'].pk,
                'fecha':(self.hoy+timedelta(days=dias)).isoformat(),'hora':'10:00'}

    def test_altas_individuales_y_multiples_todos_los_roles(self):
        for i,actor in enumerate(('B','admin','super')):
            self.assertEqual(self.enviar(actor,'post','/api/turnos/',self.datos(3+i)).status_code,201)
            datos=self.datos(); datos.pop('fecha'); datos.pop('hora')
            datos['turnos']=[{'fecha':(self.hoy+timedelta(days=10+i)).isoformat(),'hora':h} for h in ('10:00','11:00')]
            r=self.enviar(actor,'post','/api/turnos/',datos)
            self.assertEqual(r.status_code,201,r.content)
            self.assertEqual(r.json()['cantidad'],2)

    def test_todos_los_roles_rechazan_profesional_no_asignado(self):
        for actor in ('A','admin','super'):
            for multiple in (False,True):
                datos=self.datos(); datos['profesional']=self.f.profesionales['A'].pk
                if multiple: datos['turnos']=[{'fecha':datos.pop('fecha'),'hora':datos.pop('hora')}]
                antes=self.f.snapshot(); r=self.enviar(actor,'post','/api/turnos/',datos)
                self.assertEqual(r.status_code,400,r.content); self.assertEqual(self.f.snapshot(),antes)

    def test_inicio_y_fin_inclusivos_para_historia(self):
        inicio=self.hoy-timedelta(days=3); fin=self.hoy
        self.asignacion.fecha_inicio=inicio; self.asignacion.fecha_fin=fin; self.asignacion.save()
        for fecha in (inicio,inicio+timedelta(days=1),fin):
            TurnoService.validar_paciente_asignado(self.f.profesionales['B'],self.f.pacientes['B'],fecha,exigir_vigente=False)
        for fecha in (inicio-timedelta(days=1),fin+timedelta(days=1)):
            with self.assertRaises(ValidationError):
                TurnoService.validar_paciente_asignado(self.f.profesionales['B'],self.f.pacientes['B'],fecha,exigir_vigente=False)
        with self.assertRaises(ValidationError):
            TurnoService.validar_paciente_asignado(self.f.profesionales['B'],self.f.pacientes['B'],fin)

    def test_asignacion_abierta_futura_no_es_responsable_vigente(self):
        self.asignacion.fecha_inicio=self.hoy+timedelta(days=2); self.asignacion.save()
        for dias in (1,2,3):
            for actor in ('B','admin','super'):
                antes=self.f.snapshot(); r=self.enviar(actor,'post','/api/turnos/',self.datos(dias))
                self.assertEqual(r.status_code,400,r.content); self.assertEqual(self.f.snapshot(),antes)

    def test_inicio_hoy_admite_reserva_hoy_posterior(self):
        self.asignacion.fecha_inicio=self.hoy; self.asignacion.save()
        datos=self.datos(0); datos['hora']='14:00'
        self.assertEqual(self.enviar('B','post','/api/turnos/',datos).status_code,201)

    def test_lote_con_fecha_fuera_del_intervalo_no_guarda_ninguno(self):
        self.asignacion.fecha_inicio=self.hoy; self.asignacion.save()
        datos=self.datos(); datos.pop('fecha'); datos.pop('hora')
        datos['turnos']=[{'fecha':(self.hoy+timedelta(days=3)).isoformat(),'hora':'10:00'},
                         {'fecha':(self.hoy-timedelta(days=1)).isoformat(),'hora':'10:00'}]
        for actor in ('B','admin','super'):
            antes=self.f.snapshot(); r=self.enviar(actor,'post','/api/turnos/',datos)
            self.assertEqual(r.status_code,400,r.content); self.assertEqual(self.f.snapshot(),antes)

    def test_reprogramacion_revalida_aun_sin_cambiar_identidad(self):
        self.asignacion.fecha_fin=self.hoy; self.asignacion.save()
        for actor in ('B','admin','super'):
            for cambio in ({'hora':'11:00'},{'fecha':(self.hoy+timedelta(days=3)).isoformat()}):
                antes=self.f.snapshot(); r=self.enviar(actor,'patch',self.url,cambio)
                self.assertEqual(r.status_code,400,r.content); self.assertEqual(self.f.snapshot(),antes)

    def test_put_patch_validan_combinacion_final_y_conservan_permisos(self):
        for metodo in ('put','patch'):
            datos={'fecha':self.f.fecha,'hora':'11:00','paciente':self.f.pacientes['A'].pk,
                   'profesional':self.f.profesionales['B'].pk}
            antes=self.f.snapshot()
            self.assertEqual(self.enviar('admin',metodo,self.url,datos).status_code,400)
            self.assertEqual(self.f.snapshot(),antes)
        datos['profesional']=self.f.profesionales['A'].pk
        self.assertEqual(self.enviar('admin','patch',self.url,datos).status_code,200)

    def test_reasignacion_mismo_dia_conserva_historia_y_nuevas_reservas(self):
        historico=self.f.turno_registrado
        historico.fecha=self.hoy; historico.hora='09:00'; historico.save()
        antes=s.RegistroSesion.objects.values().get(pk=self.f.registro.pk)
        url=f'/api/profesionales/pacientes/{self.f.pacientes["B"].pk}/reasignar/'
        r=self.enviar('B','post',url,{'profesional_id':self.f.profesionales['A'].pk})
        self.assertEqual(r.status_code,200,r.content)
        historico.refresh_from_db(); self.f.turno.refresh_from_db(); self.asignacion.refresh_from_db()
        self.assertEqual(historico.profesional_id,self.f.profesionales['B'].pk)
        self.assertEqual(self.f.turno.profesional_id,self.f.profesionales['A'].pk)
        self.assertEqual(self.asignacion.fecha_fin,self.hoy)
        TurnoService.validar_paciente_asignado(self.f.profesionales['B'],self.f.pacientes['B'],self.hoy,exigir_vigente=False)
        datos=self.datos(0); datos['hora']='15:00'
        self.assertEqual(self.enviar('B','post','/api/turnos/',datos).status_code,400)
        datos['profesional']=self.f.profesionales['A'].pk
        self.assertEqual(self.enviar('A','post','/api/turnos/',datos).status_code,201)
        self.assertTrue(SesionesService.obtener_sesion(historico.pk,self.f.usuarios['B'])[1])
        self.assertFalse(SesionesService.obtener_sesion(historico.pk,self.f.usuarios['A'])[1])
        self.assertEqual(s.RegistroSesion.objects.values().get(pk=self.f.registro.pk),antes)
        # La acción histórica manual conserva su ruta y autorización originales.
        historico.estado=self.f.estados_turno['Confirmado']; historico.save()
        r=self.enviar('B','patch',f'/api/turnos/{historico.pk}/estado/',{'ID_EstadoTurno':self.f.estados_turno['Realizado'].pk})
        self.assertEqual(r.status_code,200,r.content)

    def test_fallo_temporal_en_segundo_transferido_revierte_toda_reasignacion(self):
        s.Turno.objects.create(paciente=self.f.pacientes['B'],profesional=self.f.profesionales['B'],
            fecha=self.f.fecha,hora='11:00',estado=self.f.estados_turno['Pendiente'])
        antes=self.f.snapshot(); original=TurnoService.validar_paciente_asignado; llamadas=[]
        def validar(*args,**kwargs):
            llamadas.append(args)
            if len(llamadas)==2: raise ValidationError({'paciente':'Fallo temporal simulado'})
            return original(*args,**kwargs)
        with patch.object(TurnoService,'validar_paciente_asignado',side_effect=validar):
            r=self.enviar('B','post',f'/api/profesionales/pacientes/{self.f.pacientes["B"].pk}/reasignar/',
                {'profesional_id':self.f.profesionales['A'].pk})
        self.assertEqual(r.status_code,400); self.assertEqual(len(llamadas),2)
        self.assertEqual(self.f.snapshot(),antes)


if __name__ == '__main__':
    unittest.main()
