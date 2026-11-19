"""Regresión H03: datos ficticios, SQLite en memoria y errores PG simulados."""
from types import SimpleNamespace
import unittest
from unittest.mock import patch, PropertyMock

import test_seguridad_csrf as s
from django.db import IntegrityError
from rest_framework.exceptions import ValidationError
from APIs.tutores.services.tutor_service import TutorService, controlar_conflicto_principal
from APIs.turnos.services.turno_service import TurnoService


class CorreccionesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()

    def test_principal_inactivo_rechaza_promocion_sin_mutar(self):
        s.PacienteTutor.objects.filter(pk=self.f.principal.pk).update(activo=False)
        antes = self.f.snapshot()
        with self.assertRaises(ValidationError) as error:
            TutorService.actualizar_relacion(self.f.relacion, {'responsable_principal': True}, self.f.usuarios['admin'])
        self.assertIn('responsable_principal', error.exception.detail)
        self.assertEqual(self.f.snapshot(), antes)

    def test_reactivar_propio_principal_mediante_crear_relacion(self):
        s.PacienteTutor.objects.filter(pk=self.f.principal.pk).update(activo=False)
        relacion = TutorService.crear_relacion(
            self.f.principal.tutor,
            {'paciente': self.f.principal.paciente, 'parentesco': self.f.parentesco, 'responsable_principal': True},
            self.f.usuarios['admin'])
        self.assertEqual(relacion.pk, self.f.principal.pk)
        self.assertTrue(relacion.activo)
        self.assertTrue(relacion.responsable_principal)

    def test_solo_traduce_indice_y_codigo_especificos_despues_de_rollback(self):
        for codigo, tabla, indice, atributo, controlado in (
            ('23505', 'pacientes_tutores', 'uq_paciente_responsable_principal', 'sqlstate', True),
            ('23505', 'pacientes_tutores', 'uq_paciente_responsable_principal', 'pgcode', True),
            ('23503', 'pacientes_tutores', 'uq_paciente_responsable_principal', 'sqlstate', False),
            ('23505', 'otra_tabla', 'uq_paciente_responsable_principal', 'sqlstate', False),
            ('23505', 'pacientes_tutores', 'otro_indice', 'sqlstate', False),
            (None, None, None, 'sqlstate', False),
        ):
            with self.subTest(codigo=codigo, tabla=tabla, indice=indice, atributo=atributo):
                causa = Exception('Conflicto ficticio')
                setattr(causa, atributo, codigo)
                causa.diag = SimpleNamespace(table_name=tabla, constraint_name=indice)
                error = IntegrityError('Error ficticio')
                error.__cause__ = causa
                antes = self.f.snapshot()

                @controlar_conflicto_principal
                @s.transaction.atomic
                def operacion():
                    s.Tutor.objects.filter(pk=self.f.tutor.pk).update(telefono='999')
                    raise error

                with self.assertRaises(ValidationError if controlado else IntegrityError):
                    operacion()
                self.assertFalse(s.transaction.get_rollback())
                self.assertEqual(self.f.snapshot(), antes)

    def reasignar(self):
        return TurnoService.reasignar_paciente(
            paciente_id=self.f.pacientes['B'].pk,
            profesional_destino_id=self.f.profesionales['A'].pk,
            usuario=self.f.usuarios['B'])

    def test_reasignacion_misma_especialidad_excluye_solo_origen(self):
        self.reasignar()
        activas = s.AsignacionProfesional.objects.filter(paciente=self.f.pacientes['B'], fecha_fin__isnull=True)
        self.assertEqual(list(activas.values_list('profesional_id', flat=True)), [self.f.profesionales['A'].pk])

    def test_otra_asignacion_del_mismo_origen_no_se_excluye(self):
        s.AsignacionProfesional.objects.create(paciente=self.f.pacientes['B'],
            profesional=self.f.profesionales['B'], fecha_inicio=s.date(2020, 1, 1))
        antes = self.f.snapshot()
        with self.assertRaises(ValidationError) as error:
            self.reasignar()
        self.assertIn('profesional_id', error.exception.detail)
        self.assertEqual(self.f.snapshot(), antes)

    def test_especialidad_ausente_rechaza_sin_mutar(self):
        # La FK es obligatoria en el modelo: simular datos esenciales ausentes.
        antes = self.f.snapshot()
        with patch.object(s.Profesional, 'especialidad', new_callable=PropertyMock, return_value=None):
            with self.assertRaises(ValidationError) as error:
                self.reasignar()
        self.assertIn('profesional_id', error.exception.detail)
        self.assertEqual(self.f.snapshot(), antes)


if __name__ == '__main__':
    unittest.main(verbosity=2)
