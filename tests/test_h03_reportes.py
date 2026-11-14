"""H03: API real con datos sinteticos y SQLite en memoria."""
import unittest
from datetime import date
import test_seguridad_csrf as s
from django.db import connection


class ReportesPropiosTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['ENGINE'] == 'django.db.backends.sqlite3'
        assert connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.paciente = self.f.pacientes['A']
        s.AsignacionProfesional.objects.filter(paciente=self.paciente).update(fecha_fin=date(2026, 6, 1))
        s.AsignacionProfesional.objects.create(paciente=self.paciente,
            profesional=self.f.profesionales['B'], fecha_inicio=date(2026, 6, 1))
        self.a = self.turno('A', date(2026, 5, 20), True)
        self.sin_sesion = self.turno('A', date(2026, 5, 21), False)
        self.b = self.turno('B', date(2026, 6, 2), True)

    def turno(self, autor, fecha, registrado):
        registro = s.RegistroSesion.objects.create(diagnostico=f'Diagnostico {autor}',
            trabajo_sesion=f'Trabajo {autor}', nota_sesion=f'Privada {autor}') if registrado else None
        return s.Turno.objects.create(paciente=self.paciente, profesional=self.f.profesionales[autor],
            fecha=fecha, hora='09:00', estado=self.f.estados_turno['Realizado' if registrado else 'Pendiente'],
            registro_sesion=registro)

    def reporte(self, actor, **filtros):
        return self.f.login(actor).get('/api/reportes/turnos/',
            {'paciente_id': self.paciente.pk, **filtros})

    def ids(self, respuesta):
        self.assertEqual(respuesta.status_code, 200, respuesta.content)
        datos = respuesta.json()
        self.assertEqual(datos['total'], len(datos['resultados']))
        return [fila['id'] for fila in datos['resultados']]

    def test_autor_conserva_actividad_historica_y_sin_sesion(self):
        r = self.reporte('A')
        self.assertEqual(self.ids(r), [self.a.pk, self.sin_sesion.pk])
        propio, pendiente = r.json()['resultados']
        self.assertEqual(propio['trabajo_sesion'], 'Trabajo A')
        self.assertEqual(propio['nota_sesion'], 'Privada A')
        for campo in ('diagnostico', 'trabajo_sesion', 'nota_sesion'):
            self.assertIsNone(pendiente[campo])

    def test_nuevo_responsable_no_recibe_actividad_anterior_ajena(self):
        r = self.reporte('B')
        self.assertEqual(self.ids(r), [self.b.pk])
        for texto in ('Diagnostico A', 'Trabajo A', 'Privada A'):
            self.assertNotIn(texto, r.content.decode())

    def test_administrador_conserva_ambos_autores_sin_campos_privados(self):
        r = self.reporte('admin')
        self.assertEqual(self.ids(r), [self.a.pk, self.sin_sesion.pk, self.b.pk])
        for fila in r.json()['resultados']:
            self.assertIn('diagnostico', fila)
            self.assertNotIn('trabajo_sesion', fila)
            self.assertNotIn('nota_sesion', fila)
        self.assertEqual(self.ids(self.reporte('admin', profesional_id=self.f.profesionales['A'].pk)),
                         [self.a.pk, self.sin_sesion.pk])
        self.assertEqual(self.reporte('admin', trabajo_sesion='Trabajo').status_code, 403)

    def test_filtros_no_amplian_alcance_y_totales_coinciden(self):
        self.assertEqual(self.ids(self.reporte('B', diagnostico='Diagnostico A')), [])
        self.assertEqual(self.ids(self.reporte('B', trabajo_sesion='Trabajo A')), [])
        self.assertEqual(self.ids(self.reporte('A', diagnostico='Diagnostico A',
            fecha_desde='2026-05-20', fecha_hasta='2026-05-20',
            estado_id=self.f.estados_turno['Realizado'].pk)), [self.a.pk])
        self.assertEqual(self.ids(self.reporte('A', estado_id=self.f.estados_turno['Pendiente'].pk)),
                         [self.sin_sesion.pk])

    def test_ids_manipulados_y_roles(self):
        self.assertEqual(self.ids(self.reporte('A', profesional_id=self.f.profesionales['B'].pk)), [])
        self.assertEqual(self.ids(self.reporte('B', profesional_id=self.f.profesionales['B'].pk)), [self.b.pk])
        self.assertEqual(self.ids(self.reporte('A', paciente_id=self.f.pacientes['B'].pk)), [])
        self.assertEqual(self.ids(self.reporte('A', paciente_id=999999)), [])
        self.assertEqual(self.ids(self.reporte('sin_vinculo')), [])
        self.assertEqual(self.reporte('otro').status_code, 403)
        self.assertEqual(s.Client().get('/api/reportes/turnos/').status_code, 401)

    def test_h04_dia_final_incluido_solo_para_autor(self):
        mismo_dia = self.turno('A', date(2026, 6, 1), True)
        mismo_dia.hora = '10:00'
        mismo_dia.save(update_fields=['hora'])
        ajeno = self.turno('B', date(2026, 6, 1), True)
        r = self.reporte('A', fecha_desde='2026-06-01', fecha_hasta='2026-06-01',
                         diagnostico='Diagnostico A', trabajo_sesion='Trabajo A',
                         estado_id=self.f.estados_turno['Realizado'].pk)
        self.assertEqual(self.ids(r), [mismo_dia.pk])
        self.assertEqual(r.json()['resultados'][0]['trabajo_sesion'], 'Trabajo A')
        self.assertEqual(r.json()['resultados'][0]['nota_sesion'], 'Privada A')
        self.assertNotIn(ajeno.pk, self.ids(self.reporte('A')))
        self.assertNotIn(mismo_dia.pk, self.ids(self.reporte('B')))
        admin = self.reporte('admin', fecha_desde='2026-06-01', fecha_hasta='2026-06-01')
        self.assertEqual(set(self.ids(admin)), {mismo_dia.pk, ajeno.pk})
        for fila in admin.json()['resultados']:
            self.assertNotIn('trabajo_sesion', fila)
            self.assertNotIn('nota_sesion', fila)

    def test_h04_fuera_del_periodo_sigue_excluido(self):
        posterior = self.turno('A', date(2026, 6, 2), True)
        anterior = self.turno('A', date(2025, 12, 31), True)
        ids = self.ids(self.reporte('A'))
        self.assertNotIn(posterior.pk, ids)
        self.assertNotIn(anterior.pk, ids)
        self.assertIn(self.a.pk, ids)

    def test_h04_retorno_a_b_a_y_periodo_de_un_dia(self):
        dia = date(2026, 6, 1)
        s.AsignacionProfesional.objects.filter(paciente=self.paciente,
            profesional=self.f.profesionales['B']).update(fecha_fin=dia)
        s.AsignacionProfesional.objects.create(paciente=self.paciente,
            profesional=self.f.profesionales['A'], fecha_inicio=dia)
        propio_a = self.turno('A', dia, True)
        propio_b = self.turno('B', dia, True)
        sin_sesion_b = self.turno('B', dia, False)
        ids_a = self.ids(self.reporte('A'))
        self.assertEqual(ids_a.count(propio_a.pk), 1)
        self.assertNotIn(propio_b.pk, ids_a)
        r = self.reporte('B')
        self.assertEqual(self.ids(r), [propio_b.pk, sin_sesion_b.pk])
        self.assertEqual(r.json()['resultados'][0]['nota_sesion'], 'Privada B')
        self.assertIsNone(r.json()['resultados'][1]['trabajo_sesion'])
        self.assertNotIn(self.b.pk, self.ids(r))
