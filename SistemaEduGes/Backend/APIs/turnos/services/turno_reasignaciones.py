from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from turnos.models import Turno
from pacientes.models.paciente_model import Paciente
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import AsignacionProfesional


class ReasignacionesTurnoMixin:
    @classmethod
    def buscar_horario_disponible(
        cls,
        *,
        turno,
        profesional,
        paciente,
    ):
        """
        Busca un horario para transferir un turno.

        Primero intenta conservar el horario original. Si está
        ocupado, avanza en intervalos de 40 minutos durante ese día.
        Al pasar al día siguiente, comienza a las 09:00.

        Respeta el límite de anticipación y la validación de horarios
        pasados. Devuelve (fecha, hora) o genera un error si no hay
        disponibilidad dentro del período permitido.
        """

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

        fecha_candidata = turno.fecha
        hora_candidata = turno.hora.replace(tzinfo=None)

        while fecha_candidata <= fecha_maxima:
            try:
                cls.validar_fecha_hora(
                    fecha_candidata,
                    hora_candidata,
                )
            except serializers.ValidationError:
                if fecha_candidata < hoy:
                    fecha_candidata = hoy
                    hora_candidata = timezone.localtime().time().replace(
                        tzinfo=None
                    )
                elif fecha_candidata > fecha_maxima:
                    break
                else:
                    inicio_candidato = datetime.combine(
                        fecha_candidata,
                        hora_candidata,
                    )
                    siguiente_candidato = inicio_candidato + timedelta(
                        minutes=cls.DURACION_MINUTOS
                    )

                    if siguiente_candidato.date() > fecha_candidata:
                        fecha_candidata += timedelta(days=1)
                        hora_candidata = time(9, 0)
                    else:
                        hora_candidata = siguiente_candidato.time()

                continue

            try:
                cls.validar_solapamiento(
                    profesional,
                    paciente,
                    fecha_candidata,
                    hora_candidata,
                    excluir_turno_id=turno.pk,
                )
            except serializers.ValidationError:
                inicio_candidato = datetime.combine(
                    fecha_candidata,
                    hora_candidata,
                )
                siguiente_candidato = inicio_candidato + timedelta(
                    minutes=cls.DURACION_MINUTOS
                )

                if siguiente_candidato.date() > fecha_candidata:
                    fecha_candidata += timedelta(days=1)
                    hora_candidata = time(9, 0)
                else:
                    hora_candidata = siguiente_candidato.time()

                continue

            return fecha_candidata, hora_candidata

        raise serializers.ValidationError({
            'turnos': (
                'No se encontró un horario disponible para '
                'transferir todos los turnos dentro del período '
                'de anticipación permitido.'
            )
        })

    @classmethod
    @transaction.atomic
    def reasignar_paciente(
        cls,
        *,
        paciente_id,
        profesional_destino_id,
        usuario,
    ):
        """
        Reasigna un paciente desde su profesional actual
        hacia otro profesional activo.

        Transfiere los turnos futuros Pendientes y Confirmados.
        Los turnos históricos no se modifican.
        """

        nombre_rol = cls.obtener_rol_autorizado(usuario)

        if nombre_rol != 'Profesional':
            raise serializers.ValidationError({
                'detail': (
                    'Solo el profesional actualmente responsable '
                    'puede reasignar un paciente.'
                )
            })

        profesional_actual = cls.obtener_profesional_usuario(
            usuario
        )

        # Orden estable, también utilizado por la edición normal del turno.
        list(Profesional.objects.select_for_update().filter(
            pk__in={profesional_actual.pk, profesional_destino_id},
        ).order_by('pk'))

        profesional_actual = (
            Profesional.objects
            .select_for_update(of=('self',))
            .select_related('estado_profesional')
            .get(pk=profesional_actual.pk)
        )

        cls.validar_profesional_activo(profesional_actual)

        try:
            paciente = (
                Paciente.objects
                .select_for_update(of=('self',))
                .select_related('estado')
                .get(pk=paciente_id)
            )
        except Paciente.DoesNotExist:
            raise serializers.ValidationError({
                'paciente': 'El paciente indicado no existe.'
            })

        cls.validar_paciente_activo(paciente)

        try:
            profesional_destino = (
                Profesional.objects
                .select_for_update(of=('self',))
                .select_related('estado_profesional')
                .get(pk=profesional_destino_id)
            )
        except Profesional.DoesNotExist:
            raise serializers.ValidationError({
                'profesional_id': (
                    'El profesional de destino no existe.'
                )
            })

        cls.validar_profesional_activo(profesional_destino)

        if profesional_destino.pk == profesional_actual.pk:
            raise serializers.ValidationError({
                'profesional_id': (
                    'El paciente ya está asignado a este profesional.'
                )
            })

        asignacion_actual = (
            AsignacionProfesional.objects
            .select_for_update()
            .filter(
                paciente=paciente,
                profesional=profesional_actual,
                fecha_fin__isnull=True,
            )
            .first()
        )

        if asignacion_actual is None:
            raise serializers.ValidationError({
                'paciente': (
                    'No podés reasignar este paciente porque '
                    'no está actualmente asignado a vos.'
                )
            })

        asignacion_destino_existente = (
            AsignacionProfesional.objects
            .filter(
                paciente=paciente,
                profesional=profesional_destino,
                fecha_fin__isnull=True,
            )
            .exists()
        )

        if asignacion_destino_existente:
            raise serializers.ValidationError({
                'paciente': (
                    'El paciente ya tiene una asignación activa '
                    'con el profesional seleccionado.'
                )
            })

        ahora = timezone.now()

        turnos_candidatos = (
            Turno.objects
            .select_for_update(of=('self',))
            .select_related(
                'estado',
                'profesional',
                'paciente',
            )
            .filter(
                paciente=paciente,
                profesional=profesional_actual,
                estado__estado__in=cls.ESTADOS_EDITABLES,
            )
            .order_by('fecha', 'hora')
        )

        turnos_a_transferir = [
            turno
            for turno in turnos_candidatos
            if cls.obtener_inicio_turno(turno) > ahora
        ]

        if any(turno.registro_sesion_id is not None for turno in turnos_a_transferir):
            raise serializers.ValidationError({
                'turnos': 'No se puede reasignar el paciente: hay turnos futuros a transferir con sesiones clínicas registradas. No se realizó ningún cambio.'
            })

        hoy = timezone.localdate()
        asignacion_actual.fecha_fin = hoy
        asignacion_actual.save(update_fields=['fecha_fin'])
        AsignacionProfesional.objects.create(
            paciente=paciente,
            profesional=profesional_destino,
            fecha_inicio=hoy,
            fecha_fin=None,
        )

        estado_pendiente = cls.obtener_estado_pendiente()
        ids_turnos = []

        for turno in turnos_a_transferir:
            fecha_nueva, hora_nueva = cls.buscar_horario_disponible(
                turno=turno,
                profesional=profesional_destino,
                paciente=paciente,
            )

            cls.validar_paciente_asignado(profesional_destino, paciente, fecha_nueva)

            turno.fecha = fecha_nueva
            turno.hora = hora_nueva
            turno.profesional = profesional_destino
            turno.estado = estado_pendiente

            turno.save(
                update_fields=[
                    'fecha',
                    'hora',
                    'profesional',
                    'estado',
                ]
            )

            ids_turnos.append(turno.pk)

        return {
            'profesional_anterior': profesional_actual,
            'profesional_nuevo': profesional_destino,
            'turnos_ids': ids_turnos,
        }
