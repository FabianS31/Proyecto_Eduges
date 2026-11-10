"""Pruebas aisladas H1/H2/H5, sin config.settings, .env ni migraciones.

Desde la raiz: venv/Scripts/python.exe -B tests/test_mejoras_incrementales.py
Requiere Node para ejecutar la exportacion CSV real con un DOM simulado.
Todos los datos y tablas existen exclusivamente en SQLite :memory:.
"""
import csv
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'SistemaEduGes' / 'Backend'))

from django.conf import settings

settings.configure(
    SECRET_KEY='solo-pruebas-locales-con-datos-ficticios',
    INSTALLED_APPS=['usuarios', 'profesionales', 'pacientes', 'turnos'],
    DATABASES={'default': {
        'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:',
    }},
    REST_FRAMEWORK={'UNAUTHENTICATED_USER': None},
    USE_TZ=True,
)

import django
django.setup()

from django.contrib.auth.hashers import check_password
from django.db import connection, transaction
from rest_framework.test import APIRequestFactory, force_authenticate
from usuarios.models.usuario_model import Usuario
from usuarios.models.rol_model import Rol
from profesionales.models.profesional_model import Profesional, Especialidad
from profesionales.models.estados_profesionales_model import EstadoProfesional
from APIs.profesionales.views import (
    ProfesionalListCreateView, ProfesionalDetailView,
)
from APIs.sesiones.views import TurnosPendientesSesionView


class AltaProfesionalesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Tablas de modelos unmanaged, creadas solo en memoria; sin migraciones.
        with connection.schema_editor() as schema:
            for model in (Rol, Especialidad, EstadoProfesional, Usuario, Profesional):
                schema.create_model(model)

    def setUp(self):
        self.atomic = transaction.atomic()
        self.atomic.__enter__()
        self.addCleanup(self.rollback)
        self.rol = Rol.objects.create(rol='Profesional')
        self.especialidad = Especialidad.objects.create(especialidad='Prueba')
        EstadoProfesional.objects.create(estado='Activo')
        self.factory = APIRequestFactory()
        self.operador = SimpleNamespace(
            is_authenticated=True,
            rol=SimpleNamespace(rol='SuperAdministrador'),
        )
        self.datos = {
            'nombre': 'Persona', 'apellido': 'Ficticia',
            'dni': '99900001', 'matricula': 'TEST-001',
            'especialidad': self.especialidad.pk, 'rol': self.rol.pk,
            'usuario': 'usuario_ficticio', 'password': 'ClaveFicticia123',
        }

    def rollback(self):
        transaction.set_rollback(True)
        self.atomic.__exit__(None, None, None)

    def request(self, metodo, datos, pk=None):
        request = getattr(self.factory, metodo)('/', datos, format='json')
        force_authenticate(request, user=self.operador)
        if pk is None:
            return ProfesionalListCreateView.as_view()(request)
        return ProfesionalDetailView.as_view()(request, pk=pk)

    def test_alta_exige_cada_credencial_sin_escribir(self):
        for omitidos in (('usuario',), ('password',), ('usuario', 'password')):
            with self.subTest(omitidos=omitidos):
                datos = {k: v for k, v in self.datos.items() if k not in omitidos}
                respuesta = self.request('post', datos)
                self.assertEqual(respuesta.status_code, 400)
                for campo in omitidos:
                    self.assertIn(campo, respuesta.data)
                self.assertEqual(Usuario.objects.count(), 0)
                self.assertEqual(Profesional.objects.count(), 0)

    def test_alta_valida_y_password_hasheada(self):
        respuesta = self.request('post', self.datos)
        self.assertEqual(respuesta.status_code, 201, respuesta.data)
        usuario = Usuario.objects.get(usuario=self.datos['usuario'])
        self.assertTrue(check_password(self.datos['password'], usuario.password))
        self.assertNotIn('password', respuesta.data)

    def test_put_y_patch_sin_credenciales_las_conservan(self):
        self.assertEqual(self.request('post', self.datos).status_code, 201)
        profesional = Profesional.objects.get()
        original = profesional.usuario.password
        for metodo in ('put', 'patch'):
            with self.subTest(metodo=metodo):
                datos = {k: v for k, v in self.datos.items()
                         if k not in ('usuario', 'password')}
                if metodo == 'patch':
                    datos = {'nombre': 'Nombre actualizado'}
                respuesta = self.request(metodo, datos, profesional.pk)
                self.assertEqual(respuesta.status_code, 200, respuesta.data)
                profesional.usuario.refresh_from_db()
                self.assertEqual(profesional.usuario.usuario, self.datos['usuario'])
                self.assertEqual(profesional.usuario.password, original)

    def test_actualizar_password_sigue_funcionando(self):
        self.request('post', self.datos)
        profesional = Profesional.objects.get()
        respuesta = self.request('patch', {'password': 'OtraClaveFicticia123'}, profesional.pk)
        self.assertEqual(respuesta.status_code, 200, respuesta.data)
        profesional.usuario.refresh_from_db()
        self.assertTrue(check_password('OtraClaveFicticia123', profesional.usuario.password))

    def test_blancos_y_password_corta_siguen_rechazados(self):
        for campo, valor in (('usuario', ''), ('password', ''), ('password', 'corta')):
            with self.subTest(campo=campo, valor=valor):
                respuesta = self.request('post', {**self.datos, campo: valor})
                self.assertEqual(respuesta.status_code, 400)
                self.assertIn(campo, respuesta.data)


class FiltrosSesionesTests(unittest.TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.usuario = SimpleNamespace(is_authenticated=True)

    def consultar(self, filtros, autenticado=True):
        request = self.factory.get('/api/sesiones/pendientes/', filtros)
        request.session = {}
        if autenticado:
            force_authenticate(request, user=self.usuario)
        return TurnosPendientesSesionView.as_view()(request)

    @patch('APIs.sesiones.views.SesionesService.listar_turnos_pendientes')
    def test_filtros_invalidos_devuelven_400_sin_consultar(self, listar):
        for campo, valor in (
            ('fecha_desde', 'no-es-fecha'), ('fecha_hasta', '2026-02-30'),
            ('fecha_desde', '2026-13-01'), ('paciente_id', 'abc'),
            ('paciente_id', '1.5'), ('paciente_id', '0'), ('paciente_id', '-1'),
        ):
            with self.subTest(campo=campo, valor=valor):
                respuesta = self.consultar({campo: valor})
                self.assertEqual(respuesta.status_code, 400)
                self.assertIn(campo, respuesta.data)
        listar.assert_not_called()

    @patch('APIs.sesiones.views.SesionesService.listar_turnos_pendientes', return_value=[])
    def test_filtros_validos_llegan_tipados_con_el_mismo_usuario(self, listar):
        respuesta = self.consultar({
            'fecha_desde': '2026-11-01', 'fecha_hasta': '2026-11-30',
            'paciente_id': '123',
        })
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.data, [])
        listar.assert_called_once_with(
            usuario=self.usuario, fecha_desde=date(2026, 11, 1),
            fecha_hasta=date(2026, 11, 30), paciente_id=123,
        )

    @patch('APIs.sesiones.views.SesionesService.listar_turnos_pendientes', return_value=[])
    def test_filtros_omitidos_vacios_o_individuales(self, listar):
        for filtros, esperados in (
            ({}, {}),
            ({'fecha_desde': '', 'fecha_hasta': '', 'paciente_id': ''}, {}),
            ({'fecha_desde': '2026-11-01'}, {'fecha_desde': date(2026, 11, 1)}),
            ({'paciente_id': '123'}, {'paciente_id': 123}),
        ):
            with self.subTest(filtros=filtros):
                listar.reset_mock()
                self.assertEqual(self.consultar(filtros).status_code, 200)
                listar.assert_called_once_with(usuario=self.usuario, **esperados)

    @patch('APIs.sesiones.views.SesionesService.listar_turnos_pendientes')
    def test_sin_autenticacion_sigue_denegado(self, listar):
        self.assertEqual(self.consultar({}, autenticado=False).status_code, 401)
        listar.assert_not_called()


class ExportacionCSVTests(unittest.TestCase):
    def exportar(self, tipo, resultados):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node es necesario para verificar H5')
        # Ejecuta la funcion de produccion sin cargar la pagina ni hacer requests.
        script = r'''
const fs = require('node:fs');
const vm = require('node:vm');
const entrada = JSON.parse(fs.readFileSync(0, 'utf8'));
const fuente = fs.readFileSync(entrada.archivo, 'utf8');
const inicio = fuente.indexOf('function exportarCSV(');
const fin = fuente.indexOf('// Helpers visuales', inicio);
let contenido = null;
const contexto = {
    hoyISO: () => '2026-11-10', notificar: () => {},
    Blob: class { constructor(partes) { contenido = partes.join(''); } },
    URL: { createObjectURL: () => 'blob:ficticio', revokeObjectURL: () => {} },
    document: {
        createElement: () => ({ click() {}, remove() {} }),
        body: { appendChild() {} },
    },
};
vm.createContext(contexto);
vm.runInContext(fuente.slice(inicio, fin), contexto);
contexto.exportarCSV(entrada.tipo, entrada.resultados);
process.stdout.write(JSON.stringify(contenido));
'''
        resultado = subprocess.run(
            [node, '-e', script],
            input=json.dumps({
                'archivo': str(ROOT / 'SistemaEduGes/Frontend/static/js/paginas/reportes.js'),
                'tipo': tipo, 'resultados': resultados,
            }),
            encoding='utf-8', capture_output=True, timeout=15, check=True,
        )
        return json.loads(resultado.stdout)

    def verificar(self, tipo, datos, esperado):
        contenido = self.exportar(tipo, datos)
        self.assertTrue(contenido.startswith('\ufeff'))
        filas = list(csv.reader(io.StringIO(contenido[1:], newline=''), delimiter=';', strict=True))
        self.assertEqual(len(filas), 2)
        self.assertEqual(len(filas[0]), len(esperado))
        self.assertEqual(filas[1], esperado)

    def test_turnos_con_comillas_separadores_y_saltos(self):
        self.verificar('turnos', [{
            'id': 0, 'fecha': '2026-11-10', 'hora': '09:00:00',
            'paciente': {'apellido': 'Pérez; "Prueba"', 'nombre': 'Ana'},
            'profesional': {'apellido': 'López', 'nombre': 'María\nLuisa'},
            'estado': {'nombre': 'Confirmado'}, 'trabajo_sesion': 'Texto "literal";\r\nsegunda línea',
        }], ['0', '2026-11-10', '09:00', 'Pérez; "Prueba", Ana',
             'López, María\nLuisa', 'Confirmado', 'Texto "literal";\r\nsegunda línea'])

    def test_pacientes_con_textos_especiales_y_nulos(self):
        self.verificar('pacientes', [{
            'id': 12, 'apellido': 'Apellido "A"', 'nombre': 'Ana;María',
            'dni': '00123456', 'obra_social': {'nombre': 'OS "Ficticia"; A'},
            'numero_afiliado': '001;02', 'estado': None,
        }], ['12', 'Apellido "A"', 'Ana;María', '00123456', '',
             'Sin asignar', '', 'OS "Ficticia"; A', '001;02', '', ''])

    def test_profesionales_con_textos_especiales(self):
        self.verificar('profesionales', [{
            'id': 7, 'apellido': 'Apellido', 'nombre': 'Nombre "Prueba"',
            'dni': '99900001', 'matricula': 'M;1',
            'especialidad': {'nombre': 'Área\nFicticia'},
            'contacto': None, 'mail': 'ficticio@example.invalid',
            'estado_profesional': {'nombre': 'Activo'},
        }], ['7', 'Apellido', 'Nombre "Prueba"', '99900001', 'M;1',
             'Área\nFicticia', '', 'ficticio@example.invalid', 'Activo'])

    def test_sin_resultados_no_genera_archivo(self):
        self.assertIsNone(self.exportar('turnos', []))


if __name__ == '__main__':
    unittest.main(verbosity=2)
