"""H03 corregido sobre índices reales, en un clúster PostgreSQL descartable.

Adapta las cinco expectativas diagnósticas de defectos sin editar la suite
preexistente. Conserva sus casos de limitaciones SQL y reactivación pendiente.
"""
import sys
import unittest
from unittest.mock import patch

import test_h03_restricciones_concurrencia as diagnostico

RUN = unittest.TextTestRunner.run


def corregido(runner, suite):
    from django.db import connection, transaction, IntegrityError
    from rest_framework.test import APIClient
    from rest_framework.exceptions import ValidationError
    from pacientes.models import PacienteTutor, Tutor
    from profesionales.models.profesional_model import Profesional
    from profesionales.models.asignacion_model import AsignacionProfesional as Asignacion
    from APIs.tutores.services.tutor_service import TutorService

    base = list(suite)[0].__class__

    class CorreccionesTests(base):
        def cliente(self):
            cliente = APIClient()
            cliente.force_authenticate(user=self.admin)
            cliente.raise_request_exception = False
            return cliente

        def comprobar_rechazo(self, respuesta, antes, campo):
            self.assertEqual(respuesta.status_code, 400, getattr(respuesta, 'data', None))
            self.assertIn(campo, respuesta.data)
            self.assertEqual(self.snapshot(), antes)

        def test_h03_a_historico_promocion_http500_y_rollback(self):
            self.historico()
            antes = self.snapshot()
            respuesta = self.cliente().patch(
                f'/relacion/{self.relaciones[0].pk}/',
                {'responsable_principal': True}, format='json')
            self.comprobar_rechazo(respuesta, antes, 'responsable_principal')
            self.resultado('Principal histórico: promoción', 'HTTP API', '400 sin cambios', '400 sin cambios')

        def test_h03_a_alta_tutor_revierte_tambien_al_tutor(self):
            self.historico()
            antes = self.snapshot()
            respuesta = self.cliente().post('/tutores/', {
                'nombre': 'Ficticio', 'apellido': 'Prueba', 'dni': '98765432',
                'telefono': '123', 'mail': 'ficticio@example.com', 'domicilio': 'Ficticio',
                'paciente_id': self.pacientes[0].pk, 'parentesco_id': self.parentesco.pk,
                'responsable_principal': True,
            }, format='json')
            self.comprobar_rechazo(respuesta, antes, 'responsable_principal')

        def test_h03_a_reactivar_otro_como_principal(self):
            self.historico()
            PacienteTutor.objects.filter(pk=self.relaciones[0].pk).update(activo=False)
            antes = self.snapshot()
            self.comprobar_rechazo(self.reactivar(), antes, 'responsable_principal')

        def test_h03_b_reasignar_hacia_especialidad_ocupada(self):
            origen = Profesional.objects.get(usuario=self.pro)
            existente = self.nuevo_profesional()
            destino = self.nuevo_profesional(existente.especialidad)
            self.insertar_sql(existente)
            antes = self.snapshot()
            self.comprobar_rechazo(self.reasignar(origen, destino), antes, 'profesional_id')

        def test_h03_b_dos_reasignaciones_api_concurrentes(self):
            origen = Profesional.objects.get(usuario=self.pro)
            otro = self.nuevo_profesional()
            self.insertar_sql(otro)
            destino = self.nuevo_profesional()
            segundo_destino = self.nuevo_profesional(destino.especialidad)
            otras_antes = list(Asignacion.objects.filter(profesional=otro).values())
            _, codigos = self.paralelo(
                lambda: self.reasignar(origen, destino),
                lambda: self.reasignar(otro, segundo_destino))
            self.assertEqual(codigos, [200, 400])
            self.assertEqual(list(Asignacion.objects.filter(profesional=otro).values()), otras_antes)
            self.assertFalse(Asignacion.objects.filter(profesional=segundo_destino).exists())
            self.assertEqual(Asignacion.objects.filter(
                paciente=self.pacientes[0], fecha_fin__isnull=True,
                profesional__especialidad=destino.especialidad).count(), 1)
            self.asignacion.refresh_from_db()
            self.assertIsNotNone(self.asignacion.fecha_fin)

        def test_h03_a_indice_real_traducido_despues_del_rollback(self):
            self.historico()
            antes = self.snapshot()
            # Fuerza exclusivamente el respaldo físico; no simula IntegrityError.
            with transaction.atomic():
                with patch.object(TutorService, 'validar_principal_disponible'):
                    respuesta = self.promover()
                self.comprobar_rechazo(respuesta, antes, 'responsable_principal')
                self.assertFalse(transaction.get_rollback())
                self.assertTrue(Tutor.objects.filter(pk=self.tutor.pk).exists())

        def test_h03_a_indice_revierte_alta_completa(self):
            self.historico()
            antes = self.snapshot()
            with patch.object(TutorService, 'validar_principal_disponible'):
                with self.assertRaises(ValidationError):
                    TutorService.crear_tutor(
                        {'dni': '87654321', 'nombre': 'Nuevo', 'apellido': 'Ficticio', 'telefono': '123'},
                        {'paciente': self.pacientes[0], 'parentesco': self.parentesco,
                         'responsable_principal': True}, self.admin)
            self.assertEqual(self.snapshot(), antes)

        def test_h03_a_otro_error_integridad_no_se_oculta(self):
            antes = self.snapshot()
            original = PacienteTutor.save

            def fallo_instancia(instancia, *args, **kwargs):
                if instancia.pk == self.relaciones[0].pk:
                    instancia.parentesco_id = -1
                    kwargs['update_fields'] = list(kwargs['update_fields']) + ['parentesco']
                    original(instancia, *args, **kwargs)
                    with connection.cursor() as cursor:
                        cursor.execute('SET CONSTRAINTS ALL IMMEDIATE')
                    return
                return original(instancia, *args, **kwargs)

            # Forzar la FK dentro del servicio: no debe convertirse en 400.
            with self.assertRaises(IntegrityError), transaction.atomic():
                with patch.object(PacienteTutor, 'save', fallo_instancia):
                    self.reemplazar()
            self.assertEqual(self.snapshot(), antes)

        def test_h03_b_reasignaciones_rollback_libera_bloqueo(self):
            origen = Profesional.objects.get(usuario=self.pro)
            otro = self.nuevo_profesional()
            self.insertar_sql(otro)
            destino = self.nuevo_profesional()
            segundo_destino = self.nuevo_profesional(destino.especialidad)
            _, codigos = self.paralelo(
                lambda: self.reasignar(origen, destino),
                lambda: self.reasignar(otro, segundo_destino), rollback=True)
            self.assertEqual(codigos, [409, 200])
            self.asignacion.refresh_from_db()
            self.assertIsNone(self.asignacion.fecha_fin)
            self.assertFalse(Asignacion.objects.filter(profesional=destino).exists())
            self.assertEqual(Asignacion.objects.filter(
                paciente=self.pacientes[0], fecha_fin__isnull=True,
                profesional__especialidad=destino.especialidad).count(), 1)

    return RUN(runner, unittest.defaultTestLoader.loadTestsFromTestCase(CorreccionesTests))


if __name__ == '__main__':
    diagnostico.cluster.probar = diagnostico.h10.probar
    with patch.object(diagnostico, 'RUN', corregido), patch.object(
            unittest.TextTestRunner, 'run', diagnostico.diagnostico):
        sys.exit(0 if diagnostico.cluster.ejecutar() else 1)
