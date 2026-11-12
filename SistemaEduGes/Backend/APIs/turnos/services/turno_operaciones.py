from django.db import transaction
from rest_framework import serializers

from turnos.models import Turno, EstadoTurno
from pacientes.models.paciente_model import Paciente
from profesionales.models.profesional_model import Profesional


class OperacionesTurnoMixin:
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
        nombre_rol = cls.obtener_rol_autorizado(usuario)

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

        cls.validar_paciente_asignado(profesional, paciente, fecha)

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

    @classmethod
    @transaction.atomic
    def crear_turnos(
        cls,
        *,
        turnos,
        paciente_id,
        usuario,
        profesional_id=None,
    ):
        if not turnos:
            raise serializers.ValidationError({
                'turnos': 'Debés indicar al menos un turno.'
            })

        nombre_rol = cls.obtener_rol_autorizado(usuario)

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

        for turno in turnos:
            cls.validar_paciente_asignado(profesional, paciente, turno['fecha'])
            cls.validar_fecha_hora(
                turno['fecha'],
                turno['hora'],
            )

            cls.validar_solapamiento(
                profesional,
                paciente,
                turno['fecha'],
                turno['hora'],
            )

        cls.validar_solapamiento_solicitado(turnos)

        estado_pendiente = cls.obtener_estado_pendiente()

        turnos_creados = []

        for turno in turnos:
            nuevo_turno = Turno.objects.create(
                fecha=turno['fecha'],
                hora=turno['hora'],
                paciente=paciente,
                profesional=profesional,
                estado=estado_pendiente,
                registro_sesion=None,
            )

            turnos_creados.append(nuevo_turno)

        return turnos_creados

    @classmethod
    @transaction.atomic
    def editar_turno(
        cls,
        *,
        turno_id,
        fecha,
        hora,
        paciente_id,
        usuario,
        profesional_id=None,
    ):
        nombre_rol = cls.obtener_rol_autorizado(usuario)

        # Mismo orden que reasignar: profesionales, pacientes y finalmente turno.
        anterior = Turno.objects.filter(pk=turno_id).values('profesional_id', 'paciente_id').first()
        if anterior is None:
            raise serializers.ValidationError({'turno': 'El turno indicado no existe.'})
        profesionales_ids = {anterior['profesional_id'], profesional_id or anterior['profesional_id']}
        list(Profesional.objects.select_for_update().filter(pk__in=profesionales_ids).order_by('pk'))
        list(Paciente.objects.select_for_update().filter(
            pk__in={anterior['paciente_id'], paciente_id},
        ).order_by('pk'))
        turno = cls.obtener_turno_bloqueado(turno_id)
        if (turno.profesional_id != anterior['profesional_id']
                or turno.paciente_id != anterior['paciente_id']):
            raise serializers.ValidationError({'turno': 'El turno cambió durante la operación. Recargá antes de editar.'})

        cls.validar_turno_editable(turno)

        cls.validar_acceso_turno(
            turno=turno,
            usuario=usuario,
            nombre_rol=nombre_rol,
        )

        if profesional_id is None:
            profesional_id = turno.profesional_id

        if nombre_rol == 'Profesional' and profesional_id != turno.profesional_id:
            raise serializers.ValidationError({'profesional': 'No podés asignar tu turno a otro profesional.'})

        if turno.registro_sesion_id is not None and (
            paciente_id != turno.paciente_id or profesional_id != turno.profesional_id
            or fecha != turno.fecha or hora != turno.hora
        ):
            raise serializers.ValidationError({
                'turno': 'El turno tiene una sesión clínica registrada. No se pueden modificar paciente, profesional, fecha ni horario.'
            })

        try:
            profesional = (
                Profesional.objects
                .select_for_update(of=('self',))
                .select_related('estado_profesional')
                .get(pk=profesional_id)
            )
        except Profesional.DoesNotExist:
            raise serializers.ValidationError({
                'profesional': (
                    'El profesional indicado no existe.'
                )
            })

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

        cls.validar_profesional_activo(profesional)
        cls.validar_paciente_activo(paciente)

        cls.validar_fecha_hora(fecha, hora)

        cls.validar_paciente_asignado(profesional, paciente, fecha)

        cls.validar_solapamiento(
            profesional,
            paciente,
            fecha,
            hora,
            excluir_turno_id=turno.pk,
        )

        turno.fecha = fecha
        turno.hora = hora
        turno.paciente = paciente
        turno.profesional = profesional

        turno.save(
            update_fields=[
                'fecha',
                'hora',
                'paciente',
                'profesional',
            ]
        )

        return turno

    @classmethod
    @transaction.atomic
    def cancelar_turno(
        cls,
        *,
        turno_id,
        usuario,
    ):
        nombre_rol = cls.obtener_rol_autorizado(usuario)

        turno = cls.obtener_turno_bloqueado(turno_id)

        cls.validar_turno_editable(turno)

        cls.validar_acceso_turno(
            turno=turno,
            usuario=usuario,
            nombre_rol=nombre_rol,
        )

        estado_cancelado = cls.obtener_estado_cancelado()

        cls.validar_estado_con_sesion(turno, 'Cancelado')

        turno.estado = estado_cancelado
        turno.save(update_fields=['estado'])

        return turno
