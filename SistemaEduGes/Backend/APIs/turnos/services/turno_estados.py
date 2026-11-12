from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from turnos.models import EstadoTurno


class EstadosTurnoMixin:
    @classmethod
    def validar_acceso_turno(
        cls,
        *,
        turno,
        usuario,
        nombre_rol,
    ):
        if nombre_rol == 'SuperAdministrador':
            return None

        if nombre_rol != 'Profesional':
            return None

        profesional_usuario = cls.obtener_profesional_usuario(
            usuario
        )

        cls.validar_profesional_activo(profesional_usuario)

        if turno.profesional_id != profesional_usuario.pk:
            raise serializers.ValidationError({
                'detail': (
                    'No tenés permiso para modificar '
                    'turnos de otro profesional.'
                )
            })

        return profesional_usuario

    @classmethod
    def validar_permiso_confirmacion(
        cls,
        *,
        turno,
        usuario,
        nombre_rol,
    ):
        if nombre_rol == 'SuperAdministrador':
            return None

        if nombre_rol != 'Profesional':
            raise serializers.ValidationError({
                'detail': (
                    'El Administrador no puede confirmar turnos. '
                    'Esta acción está reservada al Profesional '
                    'responsable.'
                )
            })

        profesional_usuario = cls.obtener_profesional_usuario(
            usuario
        )

        cls.validar_profesional_activo(profesional_usuario)

        if turno.profesional_id != profesional_usuario.pk:
            raise serializers.ValidationError({
                'detail': (
                    'Solo podés confirmar turnos que estén asignados a vos.'
                )
            })

        return profesional_usuario

    @classmethod
    def validar_permiso_asistencia(
        cls,
        *,
        turno,
        usuario,
        nombre_rol,
    ):
        if nombre_rol == 'SuperAdministrador':
            return None

        if nombre_rol != 'Profesional':
            raise serializers.ValidationError({
                'detail': (
                    'Solo el profesional responsable del turno '
                    'puede marcarlo como Ausente o Realizado.'
                )
            })

        profesional_usuario = cls.obtener_profesional_usuario(
            usuario
        )

        cls.validar_profesional_activo(profesional_usuario)

        if turno.profesional_id != profesional_usuario.pk:
            raise serializers.ValidationError({
                'detail': (
                    'No podés registrar la asistencia '
                    'de un turno de otro profesional.'
                )
            })

        return profesional_usuario

    @classmethod
    def validar_transicion_estado(
        cls,
        *,
        turno,
        estado_nuevo,
        usuario,
        nombre_rol,
    ):
        estado_actual = turno.estado.estado
        nombre_estado_nuevo = estado_nuevo.estado

        cls.validar_estado_con_sesion(turno, nombre_estado_nuevo)

        estados_permitidos = cls.TRANSICIONES_PERMITIDAS.get(
            estado_actual,
            (),
        )

        if nombre_estado_nuevo not in estados_permitidos:
            raise serializers.ValidationError({
                'estado': (
                    f'No se permite cambiar de '
                    f'"{estado_actual}" a '
                    f'"{nombre_estado_nuevo}".'
                )
            })

        if nombre_estado_nuevo == 'Confirmado':
            cls.validar_permiso_confirmacion(
                turno=turno,
                usuario=usuario,
                nombre_rol=nombre_rol,
            )

        elif nombre_estado_nuevo in ('Ausente', 'Realizado'):
            cls.validar_permiso_asistencia(
                turno=turno,
                usuario=usuario,
                nombre_rol=nombre_rol,
            )

        else:
            cls.validar_acceso_turno(
                turno=turno,
                usuario=usuario,
                nombre_rol=nombre_rol,
            )

        ahora = timezone.now()

        if nombre_estado_nuevo == 'Ausente':
            inicio_turno = cls.obtener_inicio_turno(turno)

            if ahora < inicio_turno:
                raise serializers.ValidationError({
                    'estado': (
                        'Solo se puede marcar Ausente '
                        'desde la hora de inicio del turno.'
                    )
                })

        if nombre_estado_nuevo == 'Realizado':
            fin_turno = cls.obtener_fin_turno(turno)

            if ahora < fin_turno:
                raise serializers.ValidationError({
                    'estado': (
                        'Solo se puede marcar Realizado '
                        'una vez finalizados los 40 minutos '
                        'del turno.'
                    )
                })

    @classmethod
    @transaction.atomic
    def cambiar_estado_turno(
        cls,
        *,
        turno_id,
        estado_id,
        usuario,
    ):
        nombre_rol = cls.obtener_rol_autorizado(usuario)

        turno = cls.obtener_turno_bloqueado(turno_id)

        try:
            estado_nuevo = EstadoTurno.objects.get(
                pk=estado_id
            )
        except (
            EstadoTurno.DoesNotExist,
            ValueError,
            TypeError,
        ):
            raise serializers.ValidationError({
                'estado': 'El estado indicado no existe.'
            })

        cls.validar_transicion_estado(
            turno=turno,
            estado_nuevo=estado_nuevo,
            usuario=usuario,
            nombre_rol=nombre_rol,
        )

        turno.estado = estado_nuevo
        turno.save(update_fields=['estado'])

        return turno
