
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from pacientes.models.paciente_model import Paciente, EstadoPaciente
from profesionales.models.profesional_model import Profesional
from profesionales.models.estados_profesionales_model import EstadoProfesional
from profesionales.models.asignacion_model import AsignacionProfesional
from turnos.models import Turno, EstadoTurno


class EstadoEntidadService:

    ESTADO_ACTIVO = 'Activo'
    ESTADO_INACTIVO = 'Inactivo'

    ESTADOS_TURNOS_CANCELABLES = ('Pendiente', 'Confirmado')

    @staticmethod
    def obtener_estado(modelo_estado, nombre):
        try:
            return modelo_estado.objects.get(estado=nombre)
        except modelo_estado.DoesNotExist:
            raise serializers.ValidationError(
                f'No existe el estado {nombre}.'
            )

    @classmethod
    def cancelar_turnos_futuros(cls, **filtros):
        from APIs.turnos.services.turno_service import TurnoService

        ahora = timezone.now()

        estado_cancelado = cls.obtener_estado(
            EstadoTurno,
            'Cancelado'
        )

        estados_cancelables = EstadoTurno.objects.filter(
            estado__in=cls.ESTADOS_TURNOS_CANCELABLES
        )

        turnos = Turno.objects.filter(
            **filtros,
            estado__in=estados_cancelables
        )

        ids_a_cancelar = [
            turno.pk
            for turno in turnos
            if TurnoService.obtener_inicio_turno(turno) > ahora
        ]

        if ids_a_cancelar:
            Turno.objects.filter(
                pk__in=ids_a_cancelar
            ).update(
                estado=estado_cancelado
            )

    @staticmethod
    def cerrar_asignaciones(**filtros):
        AsignacionProfesional.objects.filter(
            **filtros,
            fecha_fin__isnull=True
        ).update(
            fecha_fin=timezone.localdate()
        )

    @classmethod
    @transaction.atomic
    def cambiar_estado_paciente(cls, id_paciente, nuevo_estado):
        if nuevo_estado not in (
            cls.ESTADO_ACTIVO,
            cls.ESTADO_INACTIVO
        ):
            raise serializers.ValidationError(
                'El estado debe ser Activo o Inactivo.'
            )

        try:
            paciente = Paciente.objects.select_for_update().get(
                id_paciente=id_paciente
            )
        except Paciente.DoesNotExist:
            raise serializers.ValidationError(
                'No se encontró el paciente.'
            )

        estado = cls.obtener_estado(
            EstadoPaciente,
            nuevo_estado
        )

        paciente.estado = estado
        paciente.save(update_fields=['estado'])

        if nuevo_estado == cls.ESTADO_INACTIVO:
            cls.cancelar_turnos_futuros(
                paciente=paciente
            )

            cls.cerrar_asignaciones(
                paciente=paciente
            )

        return paciente

    @classmethod
    @transaction.atomic
    def cambiar_estado_profesional(cls, id_profesional, nuevo_estado):
        if nuevo_estado not in (
            cls.ESTADO_ACTIVO,
            cls.ESTADO_INACTIVO
        ):
            raise serializers.ValidationError(
                'El estado debe ser Activo o Inactivo.'
            )

        try:
            profesional = Profesional.objects.select_for_update().select_related(
                'usuario'
            ).get(
                id_profesional=id_profesional
            )
        except Profesional.DoesNotExist:
            raise serializers.ValidationError(
                'No se encontró el profesional.'
            )

        estado = cls.obtener_estado(
            EstadoProfesional,
            nuevo_estado
        )

        profesional.estado_profesional = estado
        profesional.save(update_fields=['estado_profesional'])

        profesional.usuario.activo = (
            nuevo_estado == cls.ESTADO_ACTIVO
        )
        profesional.usuario.save(update_fields=['activo'])

        if nuevo_estado == cls.ESTADO_INACTIVO:
            cls.cancelar_turnos_futuros(
                profesional=profesional
            )

            cls.cerrar_asignaciones(
                profesional=profesional
            )

        return profesional