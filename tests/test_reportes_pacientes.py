"""API real, datos ficticios, SQLite en memoria; sin settings operativos ni migraciones."""
import unittest
from datetime import date, timedelta
from unittest.mock import patch
import test_seguridad_csrf as s


class ReportesPacientesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME'] == ':memory:'
        assert s.connection.vendor == 'sqlite'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()

    def reporte(self, actor='A', **filtros):
        return self.f.login(actor).get('/api/reportes/pacientes/', filtros)

    def ids(self, respuesta):
        self.assertEqual(respuesta.status_code, 200, respuesta.content)
        datos = respuesta.json()
        self.assertEqual(datos['total'], len(datos['resultados']))
        return [p['id'] for p in datos['resultados']]

    def inactivar(self, nombre):
        p = self.f.pacientes[nombre]
        p.estado = s.EstadoPaciente.objects.get(estado='Inactivo')
        p.save(update_fields=['estado'])
        s.AsignacionProfesional.objects.filter(paciente=p).update(fecha_fin=date(2026, 6, 1))

    def test_admin_padron_y_profesional_propios(self):
        for actor in ('admin', 'super'):
            self.assertEqual(set(self.ids(self.reporte(actor))), {p.pk for p in self.f.pacientes.values()})
        for actor in ('A', 'B'):
            self.assertEqual(self.ids(self.reporte(actor)), [self.f.pacientes[actor].pk])

    @patch('APIs.reportes.services.reporte_service.timezone.localdate', return_value=date(2026, 11, 15))
    def test_activos_inicio_pasado_hoy_futuro_y_filtros(self, reloj):
        p = self.f.pacientes['A']
        for dias, esperado in ((-1, [p.pk]), (0, [p.pk]), (1, [])):
            with self.subTest(dias=dias):
                s.AsignacionProfesional.objects.filter(paciente=p).update(
                    fecha_inicio=reloj.return_value + timedelta(days=dias))
                for filtros in ({}, {'paciente_id': p.pk}, {'dni': p.dni},
                                {'estado_id': p.estado_id, 'obra_social_id': p.obra_social_id}):
                    self.assertEqual(self.ids(self.reporte(**filtros)), esperado)
                for actor in ('admin', 'super'):
                    r = self.reporte(actor, paciente_id=p.pk)
                    self.assertEqual(self.ids(r), [p.pk])
                    self.assertEqual(len(r.json()['resultados'][0]['profesionales_asignados']),
                                     0 if dias > 0 else 1)

    @patch('APIs.reportes.services.reporte_service.timezone.localdate', return_value=date(2026, 11, 15))
    def test_futura_no_revoca_autorizacion_independiente_ni_duplica(self, reloj):
        p = self.f.pacientes['A']
        for autor in ('A', 'B'):
            s.AsignacionProfesional.objects.create(paciente=p, profesional=self.f.profesionales[autor],
                fecha_inicio=reloj.return_value + timedelta(days=1))
        self.assertEqual(self.ids(self.reporte(paciente_id=p.pk)), [p.pk])
        self.assertEqual(self.ids(self.reporte('B', paciente_id=p.pk)), [])
        asignados = self.reporte(paciente_id=p.pk).json()['resultados'][0]['profesionales_asignados']
        self.assertEqual([a['id'] for a in asignados], [self.f.profesionales['A'].pk])
        s.AsignacionProfesional.objects.filter(paciente=p, profesional=self.f.profesionales['B']).update(
            fecha_inicio=reloj.return_value)
        self.assertEqual(self.ids(self.reporte('B', paciente_id=p.pk)), [p.pk])
        self.assertEqual(len(self.reporte(paciente_id=p.pk).json()['resultados'][0]['profesionales_asignados']), 2)

    @patch('APIs.reportes.services.reporte_service.timezone.localdate', return_value=date(2026, 11, 15))
    def test_inactivo_ultimo_responsable_iniciado_y_solo_futuro(self, reloj):
        self.inactivar('A')
        p = self.f.pacientes['A']
        futura = s.AsignacionProfesional.objects.create(paciente=p, profesional=self.f.profesionales['B'],
            fecha_inicio=reloj.return_value + timedelta(days=1))
        self.assertEqual(self.ids(self.reporte(paciente_id=p.pk)), [p.pk])
        self.assertEqual(self.ids(self.reporte('B', paciente_id=p.pk)), [])
        for dias in (-1, 0):
            futura.fecha_inicio = reloj.return_value + timedelta(days=dias)
            futura.save(update_fields=['fecha_inicio'])
            self.assertEqual(self.ids(self.reporte(paciente_id=p.pk)), [])
            self.assertEqual(self.ids(self.reporte('B', paciente_id=p.pk)), [p.pk])
        s.AsignacionProfesional.objects.filter(paciente=p).update(
            fecha_inicio=reloj.return_value + timedelta(days=1), fecha_fin=None)
        for actor in ('A', 'B'):
            self.assertEqual(self.ids(self.reporte(actor, paciente_id=p.pk)), [])
        self.assertEqual(self.ids(self.reporte('admin', paciente_id=p.pk)), [p.pk])

    def test_inactivos_ultimo_responsable_y_desempate(self):
        self.inactivar('A')
        p = self.f.pacientes['A']
        self.assertEqual(self.ids(self.reporte()), [p.pk])
        self.assertEqual(self.reporte().json()['resultados'][0]['profesionales_asignados'], [])
        self.assertEqual(self.ids(self.reporte(estado_id=p.estado_id)), [p.pk])
        self.assertEqual(self.ids(self.reporte(estado_id=self.f.pacientes['B'].estado_id)), [])
        s.AsignacionProfesional.objects.create(paciente=p, profesional=self.f.profesionales['B'],
            fecha_inicio=date(2026, 1, 1), fecha_fin=date(2026, 6, 1))
        self.assertEqual(self.ids(self.reporte()), [])
        self.assertIn(p.pk, self.ids(self.reporte('B')))

    def test_asignaciones_multiples_sin_duplicados(self):
        p = self.f.pacientes['A']
        b = self.f.profesionales['B']
        b.especialidad = s.Especialidad.objects.create(especialidad='Otra especialidad')
        b.save(update_fields=['especialidad'])
        for autor, fin in [('A', None), ('A', date(2025, 12, 31)), ('B', None)]:
            s.AsignacionProfesional.objects.create(paciente=p, profesional=self.f.profesionales[autor],
                fecha_inicio=date(2025, 1, 1), fecha_fin=fin)
        self.assertEqual(self.ids(self.reporte()), [p.pk])
        self.assertEqual(self.ids(self.reporte('B')).count(p.pk), 1)
        asignados = self.reporte().json()['resultados'][0]['profesionales_asignados']
        self.assertEqual({a['id'] for a in asignados}, {v.pk for v in self.f.profesionales.values()})
        self.assertEqual(len(asignados), 2)

    def test_manipulacion_no_amplia_autorizacion(self):
        ajeno = self.f.pacientes['B']
        for filtros in ({'paciente_id': ajeno.pk}, {'dni': ajeno.dni},
                        {'nombre': ajeno.nombre}, {'tutor_id': self.f.tutor.pk}):
            self.assertEqual(self.ids(self.reporte(**filtros)), [])
        for clave in ('ID_Profesional', 'profesional_id', 'usuario_id'):
            self.assertEqual(self.ids(self.reporte(**{clave: self.f.profesionales['B'].pk})),
                             [self.f.pacientes['A'].pk])
        self.assertEqual(self.reporte('sin_vinculo').status_code, 403)
        self.assertEqual(self.reporte('otro').status_code, 403)
        self.assertEqual(s.Client().get('/api/reportes/pacientes/').status_code, 401)

    def test_filtros_y_sin_clinica(self):
        p = self.f.pacientes['A']
        for filtros in ({'obra_social_id': p.obra_social_id}, {'dni': p.dni},
                        {'paciente_id': p.pk}, {'nombre': 'Paciente', 'apellido': 'Ficticio'}):
            respuesta = self.reporte(**filtros)
            self.assertEqual(self.ids(respuesta), [p.pk])
            for campo in ('diagnostico', 'trabajo_sesion', 'nota_sesion', 'registro_sesion'):
                self.assertNotIn(campo, respuesta.json()['resultados'][0])
        self.assertEqual(self.ids(self.reporte(obra_social_id=99999)), [])
        self.assertEqual(self.reporte(fecha_alta_desde='2026-12-01', fecha_alta_hasta='2026-01-01').status_code, 400)
        self.assertEqual(self.reporte(paciente_id=0).status_code, 400)

    def test_sin_asignacion_vigente_no_ve_activo_y_permisos_otros_reportes(self):
        s.AsignacionProfesional.objects.filter(profesional=self.f.profesionales['A']).update(fecha_fin=date(2026, 6, 1))
        self.assertEqual(self.ids(self.reporte()), [])
        cliente = self.f.login('A')
        self.assertEqual(cliente.get('/api/reportes/profesionales/').status_code, 403)
        self.assertEqual(cliente.get('/api/reportes/turnos/').status_code, 200)
        self.assertEqual(cliente.get('/api/pacientes/').json(), [])
