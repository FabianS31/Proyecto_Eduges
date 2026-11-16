"""H03: API real con datos sinteticos y SQLite en memoria."""
import unittest
from datetime import date
import test_seguridad_csrf as s
from django.db import connection


class ReportesPropiosTests(unittest.TestCase):
    def test_reportes_no_cache_en_exitos_y_errores(self):
        for tipo, filtro in (('turnos', 'paciente_id'),
                             ('pacientes', 'paciente_id'),
                             ('profesionales', 'profesional_id')):
            url = f'/api/reportes/{tipo}/'
            for actor, parametros, codigo in (
                ('admin', {}, 200), ('super', {}, 200),
                ('admin', {filtro: 'invalido'}, 400), ('otro', {}, 403),
                ('A', {}, 403 if tipo == 'profesionales' else 200),
            ):
                with self.subTest(tipo=tipo, actor=actor, codigo=codigo):
                    respuesta = self.f.login(actor).get(url, parametros)
                    self.assertEqual(respuesta.status_code, codigo)
                    self.assertIn('no-store', respuesta['Cache-Control'])
                    self.assertIn('private', respuesta['Cache-Control'])
                    self.assertIn('Expires', respuesta)
                    if codigo == 200:
                        self.assertEqual(set(respuesta.json()), {'total', 'resultados'})
                    else:
                        self.assertNotIn('resultados', respuesta.json())
                        self.assertNotIn('Privada', respuesta.content.decode())
            anonima = s.Client().get(url)
            self.assertEqual(anonima.status_code, 401)
            self.assertIn('no-store', anonima['Cache-Control'])
            self.assertNotIn('resultados', anonima.json())

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
        registro = self.a.registro_sesion
        registro.trabajo_sesion = 'Contenido exclusivo_autor_a'
        registro.save(update_fields=['trabajo_sesion'])
        self.assertEqual(self.ids(self.reporte('B', trabajo_sesion='exclusivo_autor_a')), [])
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

    def test_trabajo_palabras_acentos_parciales_y_privacidad(self):
        registro = self.a.registro_sesion
        registro.trabajo_sesion = 'ATENCIÓN sostenida y ejercicios de Memoria'
        registro.save(update_fields=['trabajo_sesion'])
        for texto in ('memoria atencion', 'ATENCIÓN; memo', 'sosten', 'ejercicios, atención'):
            with self.subTest(texto=texto):
                self.assertEqual(self.ids(self.reporte('A', trabajo_sesion=texto)), [self.a.pk])
                self.assertEqual(self.ids(self.reporte('B', trabajo_sesion=texto)), [])
                self.assertEqual(self.reporte('admin', trabajo_sesion=texto).status_code, 403)
                self.assertEqual(self.ids(self.reporte('super', trabajo_sesion=texto)), [self.a.pk])
        self.assertEqual(self.ids(self.reporte('A', trabajo_sesion='sin coincidencias')), [])

    def test_homonimos_ids_catalogo_y_especialidades(self):
        for modelo in (s.Paciente, s.Profesional):
            modelo.objects.all().update(nombre='Ana', apellido='Ficticia')
        for tipo, objetos, parametro in (
            ('pacientes', self.f.pacientes, 'paciente_id'),
            ('profesionales', self.f.profesionales, 'profesional_id'),
        ):
            for actor in ('admin', 'super'):
                cliente = self.f.login(actor)
                for objeto in objetos.values():
                    self.assertEqual(self.ids(cliente.get(f'/api/reportes/{tipo}/',
                        {parametro: objeto.pk})), [objeto.pk])
                self.assertEqual(len(self.ids(cliente.get(f'/api/reportes/{tipo}/', {'nombre': 'Ana'}))), 2)
            respuesta = self.f.login('A').get(f'/api/reportes/{tipo}/')
            if tipo == 'profesionales':
                self.assertEqual(respuesta.status_code, 403)
            else:
                self.assertEqual(self.ids(respuesta), [])  # A ya fue reemplazado por B.
        especialidades = [self.f.profesionales['A'].especialidad]
        especialidades += [s.Especialidad.objects.create(especialidad=f'Sintética {i}') for i in (2, 3)]
        profesional = self.f.profesionales['B']
        profesional.especialidad = especialidades[1]
        profesional.save(update_fields=['especialidad'])
        cliente = self.f.login('admin')
        catalogo = cliente.get('/api/profesionales/especialidades/')
        self.assertEqual(catalogo.status_code, 200)
        self.assertEqual({e['id'] for e in catalogo.json()}, {e.pk for e in especialidades})
        for esp, esperados in zip(especialidades, [[self.f.profesionales['A'].pk], [profesional.pk], []]):
            self.assertEqual(self.ids(cliente.get('/api/reportes/profesionales/',
                {'especialidad_id': esp.pk})), esperados)

    def test_rangos_y_filtros_opcionales(self):
        cliente = self.f.login('admin')
        for tipo, desde, hasta in [('turnos', 'fecha_desde', 'fecha_hasta'),
                                   ('pacientes', 'fecha_alta_desde', 'fecha_alta_hasta')]:
            self.assertEqual(cliente.get(f'/api/reportes/{tipo}/',
                {desde: '2026-11-02', hasta: '2026-11-01'}).status_code, 400)
            self.assertEqual(cliente.get(f'/api/reportes/{tipo}/').status_code, 200)
        self.assertEqual(self.ids(self.reporte('A', trabajo_sesion='')), [self.a.pk, self.sin_sesion.pk])
        self.assertEqual(self.reporte('A', paciente_id=0).status_code, 400)
