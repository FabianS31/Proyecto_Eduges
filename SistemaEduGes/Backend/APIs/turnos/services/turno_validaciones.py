from datetime import datetime, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from turnos.models import Turno, EstadoTurno
from pacientes.models.paciente_model import Paciente
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import AsignacionProfesional


class ValidacionesTurnoMixin:
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
    def obtener_estado(nombre_estado):
        try:
            return EstadoTurno.objects.get(estado=nombre_estado)
        except EstadoTurno.DoesNotExist:
            raise serializers.ValidationError({
                'estado': (
                    f'No existe el estado "{nombre_estado}" '
                    'en la base de datos.'
                )
            })

    @classmethod
    def obtener_estado_pendiente(cls):
        return cls.obtener_estado('Pendiente')

    @classmethod
    def obtener_estado_cancelado(cls):
        return cls.obtener_estado('Cancelado')

    @classmethod
    def obtener_rol_autorizado(cls, usuario):
        nombre_rol = getattr(
            getattr(usuario, 'rol', None),
            'rol',
            None,
        )

        if nombre_rol not in cls.ROLES_AUTORIZADOS:
            raise serializers.ValidationError({
                'detail': (
                    'No tenés permiso para gestionar turnos.'
                )
            })

        return nombre_rol

    @staticmethod
    def validar_profesional_activo(profesional):
        if profesional.estado_profesional.estado != 'Activo':
            raise serializers.ValidationError({
                'profesional': (
                    'No se pueden crear ni reprogramar turnos '
                    'para un profesional inactivo.'
                )
            })

    @staticmethod
    def validar_paciente_activo(paciente):
        if paciente.estado.estado != 'Activo':
            raise serializers.ValidationError({
                'paciente': (
                    'No se pueden crear ni reprogramar turnos '
                    'para un paciente inactivo.'
                )
            })

    @staticmethod
    def validar_paciente_asignado(profesional, paciente, fecha, *, exigir_vigente=True):
        # Las escrituras llaman a esta validación con el paciente bloqueado.
        # FechaFin es inclusiva para reconocer la atribución histórica.
        asignaciones = (
            AsignacionProfesional.objects.filter(
                profesional=profesional,
                paciente=paciente,
                fecha_inicio__lte=fecha,
            ).filter(Q(fecha_fin__isnull=True) | Q(fecha_fin__gte=fecha))
        )
        if not asignaciones.exists():
            raise serializers.ValidationError({
                'paciente': 'El profesional no tiene una asignación válida para el paciente en la fecha del turno.'
            })
        if exigir_vigente and not asignaciones.filter(
            fecha_fin__isnull=True, fecha_inicio__lte=timezone.localdate(),
        ).exists():
            raise serializers.ValidationError({
                'profesional': 'Las nuevas reservas y reprogramaciones deben corresponder al profesional responsable vigente del paciente.'
            })

    @classmethod
    def validar_fecha_hora(cls, fecha, hora):
        hoy = timezone.localdate()

        try:
            fecha_maxima = hoy.replace(
                year=hoy.year + cls.ANIOS_ANTICIPACION
            )
        except ValueError:
            fecha_maxima = hoy.replace(
                year=hoy.year + cls.ANIOS_ANTICIPACION,
                month=2,
                day=28,
            )

        if fecha < hoy or fecha > fecha_maxima:
            raise serializers.ValidationError({
                'fecha': (
                    'El turno debe estar entre hoy '
                    'y la misma fecha del próximo año.'
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

    @classmethod
    def obtener_inicio_turno(cls, turno):
        fecha_hora = datetime.combine(
            turno.fecha,
            turno.hora.replace(tzinfo=None),
        )

        return timezone.make_aware(
            fecha_hora,
            timezone.get_current_timezone(),
        )

    @classmethod
    def obtener_fin_turno(cls, turno):
        return cls.obtener_inicio_turno(turno) + timedelta(
            minutes=cls.DURACION_MINUTOS
        )

    @classmethod
    def validar_solapamiento(
        cls,
        profesional,
        paciente,
        fecha,
        hora,
        excluir_turno_id=None,
    ):
        inicio = datetime.combine(
            fecha,
            hora.replace(tzinfo=None),
        )

        fin = inicio + timedelta(
            minutes=cls.DURACION_MINUTOS
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
                'id_turno',
                'fecha',
                'hora',
                'profesional',
                'paciente',
            )
        )

        if excluir_turno_id is not None:
            turnos_existentes = turnos_existentes.exclude(
                pk=excluir_turno_id
            )

        for turno in turnos_existentes:
            inicio_existente = datetime.combine(
                turno.fecha,
                turno.hora.replace(tzinfo=None),
            )

            fin_existente = inicio_existente + timedelta(
                minutes=cls.DURACION_MINUTOS
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
    def validar_solapamiento_solicitado(cls, turnos):
        turnos_ordenados = sorted(
            turnos,
            key=lambda turno: (
                turno['fecha'],
                turno['hora'],
            ),
        )

        for indice in range(len(turnos_ordenados) - 1):
            turno_actual = turnos_ordenados[indice]
            siguiente_turno = turnos_ordenados[indice + 1]

            if turno_actual['fecha'] != siguiente_turno['fecha']:
                continue

            inicio_actual = datetime.combine(
                turno_actual['fecha'],
                turno_actual['hora'].replace(tzinfo=None),
            )

            fin_actual = inicio_actual + timedelta(
                minutes=cls.DURACION_MINUTOS
            )

            inicio_siguiente = datetime.combine(
                siguiente_turno['fecha'],
                siguiente_turno['hora'].replace(tzinfo=None),
            )

            if inicio_siguiente < fin_actual:
                raise serializers.ValidationError({
                    'turnos': (
                        'Hay horarios que se superponen '
                        'dentro de la solicitud.'
                    )
                })

    @staticmethod
    def obtener_turno_bloqueado(turno_id):
        try:
            return (
                Turno.objects
                .select_for_update(of=('self',))
                .select_related(
                    'estado',
                    'profesional__estado_profesional',
                    'paciente__estado',
                )
                .get(pk=turno_id)
            )
        except Turno.DoesNotExist:
            raise serializers.ValidationError({
                'turno': 'El turno indicado no existe.'
            })

    @classmethod
    def validar_turno_editable(cls, turno):
        if turno.estado.estado not in cls.ESTADOS_EDITABLES:
            raise serializers.ValidationError({
                'estado': (
                    'Solamente se pueden editar o cancelar '
                    'turnos Pendientes o Confirmados.'
                )
            })

    @staticmethod
    def validar_estado_con_sesion(turno, estado):
        if turno.registro_sesion_id is not None and estado in ('Ausente', 'Cancelado'):
            raise serializers.ValidationError({
                'estado': 'El turno tiene una sesión clínica registrada. No puede marcarse Ausente ni Cancelado.'
            })
