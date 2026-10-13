from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from turnos.models import Turno, EstadoTurno
from pacientes.models.paciente_model import Paciente
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import AsignacionProfesional


class TurnoService:

    DURACION_MINUTOS = 60
    DIAS_ANTICIPACION = 30

    @staticmethod
    def obtener_profesional_usuario(usuario):
        try:
            return Profesional.objects.select_related(
                'estado_profesional'
            ).get(usuario=usuario)
        except Profesional.DoesNotExist:
            raise serializers.ValidationError({
                'profesional': (
                    'El usuario autenticado no está '
                    'vinculado a un profesional.'
                )
            })

    @staticmethod
    def obtener_estado_pendiente():
        try:
            return EstadoTurno.objects.get(
                estado='Pendiente'
            )
        except EstadoTurno.DoesNotExist:
            raise serializers.ValidationError({
                'estado': (
                    'No existe el estado "Pendiente" '
                    'en la base de datos.'
                )
            })

    @staticmethod
    def validar_profesional_activo(profesional):
        if profesional.estado_profesional.estado != 'Activo':
            raise serializers.ValidationError({
                'profesional': (
                    'No se pueden crear turnos para '
                    'un profesional inactivo.'
                )
            })

    @staticmethod
    def validar_paciente_activo(paciente):
        if paciente.estado.estado != 'Activo':
            raise serializers.ValidationError({
                'paciente': (
                    'No se pueden crear turnos para '
                    'un paciente inactivo.'
                )
            })

    @staticmethod
    def validar_paciente_asignado(profesional, paciente):
        asignacion_activa = (
            AsignacionProfesional.objects.filter(
                profesional=profesional,
                paciente=paciente,
                fecha_fin__isnull=True,
            ).exists()
        )

        if not asignacion_activa:
            raise serializers.ValidationError({
                'paciente': (
                    'El paciente no está asignado '
                    'actualmente a este profesional.'
                )
            })

    @staticmethod
    def validar_fecha_hora(fecha, hora):
        hoy = timezone.localdate()
        fecha_maxima = hoy + timedelta(
            days=TurnoService.DIAS_ANTICIPACION
        )

        if fecha < hoy or fecha > fecha_maxima:
            raise serializers.ValidationError({
                'fecha': (
                    'El turno debe estar entre hoy '
                    'y los próximos 30 días.'
                )
            })

        hora_actual = timezone.localtime().time().replace(
            tzinfo=None
        )
        hora_solicitada = hora.replace(tzinfo=None)

        if fecha == hoy and hora_solicitada <= hora_actual:
            raise serializers.ValidationError({
                'hora': (
                    'No se puede reservar un horario '
                    'que ya pasó.'
                )
            })

    @staticmethod
    def validar_solapamiento(
        profesional,
        paciente,
        fecha,
        hora,
    ):
        inicio = datetime.combine(fecha, hora)
        fin = inicio + timedelta(
            minutes=TurnoService.DURACION_MINUTOS
        )

        turnos_existentes = (
            Turno.objects
            .filter(fecha=fecha)
            .filter(
                Q(profesional=profesional)
                | Q(paciente=paciente)
            )
            .exclude(estado__estado='Cancelado')
            .only(
                'fecha',
                'hora',
                'profesional',
                'paciente',
            )
        )

        for turno in turnos_existentes:
            inicio_existente = datetime.combine(
                turno.fecha,
                turno.hora,
            )
            fin_existente = inicio_existente + timedelta(
                minutes=TurnoService.DURACION_MINUTOS
            )

            if (
                inicio < fin_existente
                and inicio_existente < fin
            ):
                raise serializers.ValidationError({
                    'hora': (
                        'El horario se superpone con otro '
                        'turno del mismo profesional o paciente.'
                    )
                })

    @classmethod
    @transaction.atomic
    def crear_turno(
        cls,
        *,
        fecha,
        hora,
        paciente_id,
        usuario,
        profesional_id=None,
    ):
        nombre_rol = getattr(
            getattr(usuario, 'rol', None),
            'rol',
            None,
        )

        if nombre_rol not in (
            'Profesional',
            'Administrador',
            'SuperAdministrador',
        ):
            raise serializers.ValidationError({
                'detail': 'No tenés permiso para crear turnos.'
            })

        if nombre_rol == 'Profesional':
            profesional = cls.obtener_profesional_usuario(
                usuario
            )

            if (
                profesional_id is not None
                and profesional_id != profesional.pk
            ):
                raise serializers.ValidationError({
                    'profesional': (
                        'No podés crear turnos para '
                        'otro profesional.'
                    )
                })
        else:
            if profesional_id is None:
                raise serializers.ValidationError({
                    'profesional': (
                        'Debés indicar el profesional del turno.'
                    )
                })

            try:
                profesional = Profesional.objects.get(
                    pk=profesional_id
                )
            except Profesional.DoesNotExist:
                raise serializers.ValidationError({
                    'profesional': (
                        'El profesional indicado no existe.'
                    )
                })

        try:
            paciente = Paciente.objects.get(pk=paciente_id)
        except Paciente.DoesNotExist:
            raise serializers.ValidationError({
                'paciente': 'El paciente indicado no existe.'
            })

        # Bloquear primero al profesional y luego al paciente.
        try:
            profesional = (
                Profesional.objects
                .select_for_update()
                .select_related('estado_profesional')
                .get(pk=profesional.pk)
            )

            paciente = (
                Paciente.objects
                .select_for_update()
                .select_related('estado')
                .get(pk=paciente.pk)
            )
        except (
            Profesional.DoesNotExist,
            Paciente.DoesNotExist,
        ):
            raise serializers.ValidationError({
                'detail': (
                    'El profesional o el paciente ya no existe.'
                )
            })

        cls.validar_profesional_activo(profesional)
        cls.validar_paciente_activo(paciente)

        if nombre_rol == 'Profesional':
            cls.validar_paciente_asignado(
                profesional,
                paciente,
            )

        cls.validar_fecha_hora(fecha, hora)

        cls.validar_solapamiento(
            profesional,
            paciente,
            fecha,
            hora,
        )

        estado_pendiente = cls.obtener_estado_pendiente()

        return Turno.objects.create(
            fecha=fecha,
            hora=hora,
            paciente=paciente,
            profesional=profesional,
            estado=estado_pendiente,
            registro_sesion=None,
        )