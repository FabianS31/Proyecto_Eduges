"""Rutas reales con datos sintéticos, SQLite :memory:, sin config.settings.

Ejecutar directamente con python -B tests/test_h02_h09.py.
No demuestra bloqueos PostgreSQL: la carrera real requiere otro entorno aislado.
"""
import socket
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
if settings.configured:
    raise RuntimeError('Ejecutar en un proceso nuevo, sin configuración Django previa.')

import test_altas_etapa4b as base
import test_seguridad_csrf as s
from APIs.pacientes.serializers.paciente_serializer import PacienteAltaSerializer
from APIs.tutores.serializers import TutorEntradaSerializer

if (set(settings.DATABASES) != {'default'}
        or settings.DATABASES['default']['ENGINE'] != 'django.db.backends.sqlite3'
        or settings.DATABASES['default']['NAME'] != ':memory:'):
    raise RuntimeError('Solo se admite SQLite en memoria.')


class CorreccionesTests(base.AltaTests):
    # Incluye regresiones de atomicidad, reutilización, roles y CSRF del alta.
    def test_movil_opcional_omitido_vacio_y_nulo(self):
        for indice, valor in enumerate(('omitido', '', None)):
            datos = self.datos()
            datos['dni'] = str(40123000 + indice)
            datos['tutor']['dni'] = str(20123000 + indice)
            for campo in ('movil',):
                if valor == 'omitido':
                    datos['tutor'].pop(campo, None)
                else:
                    datos['tutor'][campo] = valor
            r = self.post(datos)
            self.assertEqual(r.status_code, 201, r.content)
            tutor = s.Tutor.objects.get(dni=datos['tutor']['dni'])
            self.assertEqual(tutor.telefono, '123')
            self.assertTrue(s.PacienteTutor.objects.filter(
                paciente_id=r.json()['id_paciente'], tutor=tutor,
                responsable_principal=True, activo=True).exists())

    def test_contactos_obligatorios_y_formatos(self):
        casos = [(campo, valor) for campo in ('telefono', 'mail', 'domicilio')
                 for valor in (None, '', '   ', 'omitido')]
        casos += [('mail', 'invalido'), ('domicilio', 'correo@example.com')]
        for campo, valor in casos:
            with self.subTest(campo=campo, valor=valor):
                datos = self.datos()
                if valor == 'omitido':
                    datos['tutor'].pop(campo)
                else:
                    datos['tutor'][campo] = valor
                antes = self.f.snapshot()
                r = self.post(datos)
                self.assertEqual(r.status_code, 400, r.content)
                self.assertIn(campo, r.json()['tutor'])
                self.assertEqual(self.f.snapshot(), antes)

    def test_reutilizacion_historica_autorizada_no_sobrescribe_contactos(self):
        s.Tutor.objects.filter(pk=self.f.tutor.pk).update(telefono=None, mail=None, domicilio=None)
        original = s.Tutor.objects.get(pk=self.f.tutor.pk).__dict__.copy()
        for indice, actor in enumerate(('B', 'admin', 'super')):
            datos = self.datos()
            datos['dni'] = str(40123200 + indice)
            datos['tutor']['dni'] = self.f.tutor.dni
            datos['profesional'] = self.f.profesionales['B'].pk
            r = self.post(datos, actor)
            self.assertEqual(r.status_code, 201, r.content)
            tutor = s.Tutor.objects.get(pk=self.f.tutor.pk)
            for campo in ('nombre', 'apellido', 'telefono', 'mail', 'domicilio'):
                self.assertEqual(getattr(tutor, campo), original[campo])
            self.assertEqual(s.Tutor.objects.filter(dni=tutor.dni).count(), 1)
            self.assertTrue(s.PacienteTutor.objects.filter(
                paciente_id=r.json()['id_paciente'], tutor=tutor,
                responsable_principal=True, activo=True).exists())

    def test_contrato_compartido_de_tutores_no_cambia(self):
        campos = TutorEntradaSerializer().fields
        self.assertFalse(campos['telefono'].required)
        self.assertTrue(campos['mail'].required)
        self.assertTrue(campos['domicilio'].required)
        serializer = TutorEntradaSerializer(self.f.tutor, data={'movil': '123'}, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_alta_admin_y_tecnica_con_responsable_activo(self):
        for indice, actor in enumerate(('admin', 'super')):
            datos = self.datos()
            datos['dni'] = str(40123100 + indice)
            datos['tutor']['dni'] = str(20123100 + indice)
            datos['profesional'] = self.f.profesionales['A'].pk
            r = self.post(datos, actor)
            self.assertEqual(r.status_code, 201, r.content)
            self.assertTrue(s.AsignacionProfesional.objects.filter(
                paciente_id=r.json()['id_paciente'], profesional=self.f.profesionales['A'],
                fecha_fin__isnull=True).exists())

    def test_destinos_invalidos_no_dejan_datos_parciales(self):
        inactivo = s.EstadoProfesional.objects.get(estado='Inactivo')
        s.Profesional.objects.filter(pk=self.f.profesionales['A'].pk).update(estado_profesional=inactivo)
        for actor in ('admin', 'super'):
            for destino in (None, 999999, self.f.profesionales['A'].pk):
                datos = self.datos()
                if destino is not None:
                    datos['profesional'] = destino
                antes = self.f.snapshot()
                r = self.post(datos, actor)
                self.assertEqual(r.status_code, 400, r.content)
                self.assertIn('profesional', r.json())
                self.assertEqual(self.f.snapshot(), antes)

    def test_relee_estado_al_guardar_despues_de_validar(self):
        datos = self.datos()
        datos['profesional'] = self.f.profesionales['A'].pk
        serializer = PacienteAltaSerializer(data=datos, context={
            'request': SimpleNamespace(user=self.f.usuarios['admin'])})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        inactivo = s.EstadoProfesional.objects.get(estado='Inactivo')
        s.Profesional.objects.filter(pk=datos['profesional']).update(estado_profesional=inactivo)
        antes = self.f.snapshot()
        from rest_framework.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            serializer.save()
        self.assertEqual(self.f.snapshot(), antes)


if __name__ == '__main__':
    # Cualquier conexión de red accidental falla antes de alcanzar un servidor.
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('Red prohibida en tests')):
        unittest.main()
