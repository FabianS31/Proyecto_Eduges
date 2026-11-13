"""Pruebas temporales aisladas para el registro de sesiones."""
from datetime import timedelta
from unittest.mock import patch
import unittest

import test_seguridad_csrf as soporte
from django.utils import timezone

from turnos.models import EstadoTurno


class SesionesTemporalesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        soporte.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = soporte.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.estado_ausente = EstadoTurno.objects.create(
            estado='Ausente'
        )

    def configurar_turno(self, estado, inicio):
        turno = self.f.turno
        turno.fecha = inicio.date()
        turno.hora = inicio.time()
        turno.estado = estado
        turno.registro_sesion = None
        turno.save(update_fields=[
            'fecha',
            'hora',
            'estado',
            'registro_sesion',
        ])
        return turno

    def registrar(self, ahora=None):
        cliente = self.f.login('B')
        datos = {
            'turno_id': self.f.turno.pk,
            'trabajo_sesion': 'Trabajo de prueba',
            'diagnostico': 'Diagnostico de prueba',
            'nota_sesion': 'Nota de prueba',
        }
        if ahora is None:
            return cliente.post(
                '/api/sesiones/',
                datos,
                content_type='application/json',
                HTTP_X_CSRFTOKEN=self.f.token(cliente),
            )

        with patch(
            'APIs.sesiones.services.sesiones_services.timezone.localtime',
            return_value=ahora,
        ):
            return cliente.post(
                '/api/sesiones/',
                datos,
                content_type='application/json',
                HTTP_X_CSRFTOKEN=self.f.token(cliente),
            )

    def test_confirmado_futuro_rechazado(self):
        ahora = timezone.localtime().replace(second=0, microsecond=0)
        self.configurar_turno(
            self.f.estados_turno['Confirmado'],
            ahora + timedelta(minutes=10),
        )

        respuesta = self.registrar(ahora)

        self.assertEqual(respuesta.status_code, 400, respuesta.content)

    def test_confirmado_al_inicio_permitido(self):
        ahora = timezone.localtime().replace(second=0, microsecond=0)
        self.configurar_turno(
            self.f.estados_turno['Confirmado'],
            ahora,
        )

        respuesta = self.registrar(ahora)

        self.assertEqual(respuesta.status_code, 201, respuesta.content)

    def test_realizado_historico_permitido(self):
        ahora = timezone.localtime().replace(second=0, microsecond=0)
        self.configurar_turno(
            self.f.estados_turno['Realizado'],
            ahora - timedelta(days=1),
        )

        respuesta = self.registrar(ahora)

        self.assertEqual(respuesta.status_code, 201, respuesta.content)

    def test_pendiente_rechazado(self):
        ahora = timezone.localtime().replace(second=0, microsecond=0)
        self.configurar_turno(
            self.f.estados_turno['Pendiente'],
            ahora - timedelta(minutes=10),
        )

        respuesta = self.registrar(ahora)

        self.assertEqual(respuesta.status_code, 400, respuesta.content)

    def test_cancelado_rechazado(self):
        ahora = timezone.localtime().replace(second=0, microsecond=0)
        self.configurar_turno(
            self.f.estados_turno['Cancelado'],
            ahora - timedelta(minutes=10),
        )

        respuesta = self.registrar(ahora)

        self.assertEqual(respuesta.status_code, 400, respuesta.content)

    def test_ausente_rechazado(self):
        ahora = timezone.localtime().replace(second=0, microsecond=0)
        self.configurar_turno(
            self.estado_ausente,
            ahora - timedelta(minutes=10),
        )

        respuesta = self.registrar(ahora)

        self.assertEqual(respuesta.status_code, 400, respuesta.content)

    def test_no_se_permite_duplicar_sesion(self):
        ahora = timezone.localtime().replace(second=0, microsecond=0)
        self.configurar_turno(
            self.f.estados_turno['Confirmado'],
            ahora - timedelta(minutes=10),
        )

        primera = self.registrar(ahora)
        segunda = self.registrar(ahora)

        self.assertEqual(primera.status_code, 201, primera.content)
        self.assertEqual(segunda.status_code, 400, segunda.content)
