"""Rutas reales y CSRF; SQLite en memoria, sin configuracion externa."""
import unittest
from unittest.mock import patch
from datetime import timedelta
import test_seguridad_csrf as s


class IntegridadClinicaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.url = f'/api/turnos/{self.f.turno.pk}/'
        self.reasignar = f'/api/profesionales/pacientes/{self.f.pacientes["B"].pk}/reasignar/'

    def enviar(self, actor, metodo, url, datos):
        c = self.f.login(actor)
        return getattr(c, metodo)(url, datos, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c))

    def registrar(self):
        r = self.enviar('B', 'post', '/api/sesiones/', dict(turno_id=self.f.turno.pk,
            trabajo_sesion='Trabajo original', diagnostico='Diagnostico original', nota_sesion='Nota original'))
        self.assertEqual(r.status_code, 201, r.content)
        self.f.turno.refresh_from_db()

    def transferir(self):
        return self.enviar('B', 'post', self.reasignar, {'profesional_id': self.f.profesionales['A'].pk})

    def test_edicion_sin_sesion_conserva_autorizaciones(self):
        for actor in ('B', 'admin', 'super'):
            r = self.enviar(actor, 'patch', self.url, {'hora': '11:00'})
            self.assertEqual(r.status_code, 200, r.content)
        antes = self.f.snapshot()
        for actor in ('A', 'otro', 'sin_vinculo'):
            self.assertIn(self.enviar(actor, 'patch', self.url, {'hora':'12:00'}).status_code, (400,403))
            self.assertEqual(self.f.snapshot(), antes)

    def test_sesion_protege_cuatro_campos_para_todos_los_roles(self):
        self.registrar()
        cambios = [{'paciente': self.f.pacientes['A'].pk}, {'profesional':self.f.profesionales['A'].pk},
            {'fecha':(s.timezone.localdate()+timedelta(days=3)).isoformat()}, {'hora':'10:00'}]
        antes = self.f.snapshot()
        for actor in ('B', 'admin', 'super'):
            for datos in cambios:
                for metodo in ('patch','put'):
                    payload = datos if metodo=='patch' else {
                        'fecha':self.f.fecha,'hora':'09:00','paciente':self.f.pacientes['B'].pk,**datos}
                    r = self.enviar(actor, metodo, self.url, payload)
                    self.assertEqual(r.status_code, 400, r.content)
                    self.assertEqual(self.f.snapshot(), antes)

    def test_peticion_sin_cambios_y_edicion_clinica_siguen_permitidas(self):
        self.registrar()
        for actor in ('B','admin','super'):
            r = self.enviar(actor,'patch',self.url,{'hora':'09:00'})
            self.assertEqual(r.status_code,200,r.content)
        r = self.enviar('B','patch',f'/api/sesiones/{self.f.turno.pk}/',{'nota_sesion':'Actualizada'})
        self.assertEqual(r.status_code,200,r.content)
        self.assertEqual(self.enviar('admin','patch',f'/api/sesiones/{self.f.turno.pk}/',
            {'nota_sesion':'No autorizada'}).status_code,403)

    def test_profesional_no_puede_ceder_su_turno(self):
        antes = self.f.snapshot()
        r = self.enviar('B','patch',self.url,{'profesional':self.f.profesionales['A'].pk})
        self.assertEqual(r.status_code,400,r.content)
        self.assertEqual(self.f.snapshot(),antes)

    def test_confirmacion_legitima_no_altera_sesion(self):
        self.registrar()
        registro = s.RegistroSesion.objects.values().get(pk=self.f.turno.registro_sesion_id)
        r = self.enviar('B','patch',self.url+'estado/',
            {'ID_EstadoTurno':self.f.estados_turno['Confirmado'].pk})
        self.assertEqual(r.status_code,200,r.content)
        self.assertEqual(s.RegistroSesion.objects.values().get(pk=self.f.turno.registro_sesion_id),registro)

    def test_admin_y_super_conservan_cambio_legitimo_sin_sesion(self):
        for actor in ('admin','super'):
            r = self.enviar(actor,'patch',self.url,{'profesional':self.f.profesionales['A'].pk,
                'paciente':self.f.pacientes['A'].pk})
            self.assertEqual(r.status_code,200,r.content)

    def test_reasignacion_protegida_no_escribe_ninguna_tabla(self):
        self.registrar()
        s.Turno.objects.create(paciente=self.f.pacientes['B'],profesional=self.f.profesionales['B'],
            fecha=self.f.fecha,hora='08:00',estado=self.f.estados_turno['Pendiente'])
        antes = self.f.snapshot()
        r = self.transferir()
        self.assertEqual(r.status_code,400,r.content)
        self.assertIn('sesiones',r.content.decode())
        self.assertEqual(self.f.snapshot(),antes)

    def test_reasignacion_sin_conflicto_preserva_historia_y_accesos(self):
        antes = s.RegistroSesion.objects.values().get(pk=self.f.registro.pk)
        r = self.transferir()
        self.assertEqual(r.status_code,200,r.content)
        self.f.turno.refresh_from_db(); self.f.turno_registrado.refresh_from_db()
        self.assertEqual(self.f.turno.profesional_id,self.f.profesionales['A'].pk)
        self.assertEqual(self.f.turno_registrado.profesional_id,self.f.profesionales['B'].pk)
        self.assertEqual(s.RegistroSesion.objects.values().get(pk=self.f.registro.pk),antes)
        from APIs.sesiones.services.sesiones_services import SesionesService
        self.assertTrue(SesionesService.obtener_sesion(self.f.turno_registrado.pk,self.f.usuarios['B'])[1])
        self.assertFalse(SesionesService.obtener_sesion(self.f.turno_registrado.pk,self.f.usuarios['A'])[1])

    def test_error_en_transferencia_revierte_asignaciones_y_turnos(self):
        s.Turno.objects.create(paciente=self.f.pacientes['B'],profesional=self.f.profesionales['B'],
            fecha=self.f.fecha,hora='11:00',estado=self.f.estados_turno['Pendiente'])
        antes = self.f.snapshot()
        original = s.Turno.save
        guardados = []
        def fallar_segundo(turno, *args, **kwargs):
            guardados.append(turno.pk)
            if len(guardados)==2: raise RuntimeError('fallo simulado')
            return original(turno,*args,**kwargs)
        with patch.object(s.Turno,'save',fallar_segundo):
            with self.assertRaises(RuntimeError): self.transferir()
        self.assertEqual(len(guardados),2)
        self.assertEqual(self.f.snapshot(),antes)

    def test_sesion_impide_ausente_cancelado_y_delete_sin_escrituras(self):
        self.registrar()
        self.f.turno.fecha=s.timezone.localdate()-timedelta(days=1)
        self.f.turno.estado=self.f.estados_turno['Confirmado']
        self.f.turno.save()
        ausente=s.EstadoTurno.objects.create(estado='Ausente')
        antes=self.f.snapshot()
        for actor in ('B','admin','super'):
            for estado in (ausente,self.f.estados_turno['Cancelado']):
                r=self.enviar(actor,'patch',self.url+'estado/',{'ID_EstadoTurno':estado.pk})
                self.assertEqual(r.status_code,400,r.content)
                self.assertEqual(self.f.snapshot(),antes)
            self.assertEqual(self.enviar(actor,'delete',self.url,{}).status_code,400)
            self.assertEqual(self.f.snapshot(),antes)

    def test_sesion_conserva_estado_y_permite_realizado_manual(self):
        self.f.turno.fecha=s.timezone.localdate()-timedelta(days=1)
        self.f.turno.estado=self.f.estados_turno['Confirmado']; self.f.turno.save()
        self.registrar()
        self.assertEqual(self.f.turno.estado.estado,'Confirmado')
        antes=self.f.snapshot()
        self.assertEqual(self.enviar('admin','patch',self.url+'estado/',
            {'ID_EstadoTurno':self.f.estados_turno['Realizado'].pk}).status_code,400)
        self.assertEqual(self.f.snapshot(),antes)
        r=self.enviar('B','patch',self.url+'estado/',{'ID_EstadoTurno':self.f.estados_turno['Realizado'].pk})
        self.assertEqual(r.status_code,200,r.content)
        self.assertEqual(list(s.RegistroSesion.objects.order_by('pk').values()),antes['turnos.RegistroSesion'])

    def test_ausente_cancelado_no_admiten_nuevas_sesiones(self):
        ausente=s.EstadoTurno.objects.create(estado='Ausente')
        for estado in (ausente,self.f.estados_turno['Cancelado']):
            self.f.turno.estado=estado; self.f.turno.save()
            antes=self.f.snapshot()
            for actor in ('B','super'):
                r=self.enviar(actor,'post','/api/sesiones/',{'turno_id':self.f.turno.pk,
                    'trabajo_sesion':'Prueba','diagnostico':'Prueba','nota_sesion':''})
                self.assertEqual(r.status_code,400,r.content)
                self.assertEqual(self.f.snapshot(),antes)
            from APIs.sesiones.services.sesiones_services import SesionesService
            self.assertFalse(SesionesService.listar_turnos_pendientes(self.f.usuarios['B']).filter(pk=self.f.turno.pk).exists())

    def test_sin_sesion_conserva_ausente_y_cancelacion(self):
        ausente=s.EstadoTurno.objects.create(estado='Ausente')
        self.f.turno.fecha=s.timezone.localdate()-timedelta(days=1)
        self.f.turno.estado=self.f.estados_turno['Confirmado']; self.f.turno.save()
        r=self.enviar('B','patch',self.url+'estado/',{'ID_EstadoTurno':ausente.pk})
        self.assertEqual(r.status_code,200,r.content)
        self.f.turno.estado=self.f.estados_turno['Pendiente']; self.f.turno.save()
        self.assertEqual(self.enviar('admin','delete',self.url,{}).status_code,200)

    def test_inhabilitacion_con_sesion_futura_revierte_todo(self):
        self.registrar()
        antes=self.f.snapshot()
        for actor,url in [('B',f'/api/pacientes/{self.f.pacientes["B"].pk}/estado/'),
                          ('super',f'/api/profesionales/{self.f.profesionales["B"].pk}/estado/')]:
            r=self.enviar(actor,'patch',url,{'estado':'Inactivo'})
            self.assertEqual(r.status_code,400,r.content)
            self.assertIn('sesiones',r.content.decode())
            self.assertEqual(self.f.snapshot(),antes)


if __name__ == '__main__':
    unittest.main()
