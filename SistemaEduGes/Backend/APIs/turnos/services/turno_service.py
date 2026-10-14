
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from turnos.models import Turno, EstadoTurno
from pacientes.models.paciente_model import Paciente
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import (
    AsignacionProfesional
)


class TurnoService:

    DURACION_MINUTOS = 60
    DIAS_ANTICIPACION = 30

    ESTADOS_EDITABLES = (
        'Pendiente',
        'Confirmado',
    )

    ROLES_AUTORIZADOS = (
        'Profesional',
        'Administrador',
        'SuperAdministrador',
    )

    # ---------------------------------------------------------
    # OBTENER PROFESIONAL DEL USUARIO
    # ---------------------------------------------------------

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

    # ---------------------------------------------------------
    # OBTENER ESTADOS
    # ---------------------------------------------------------

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
    def obtener_estado_cancelado():
        try:
            return EstadoTurno.objects.get(
                estado='Cancelado'
            )

        except EstadoTurno.DoesNotExist:
            raise serializers.ValidationError({
                'estado': (
                    'No existe el estado "Cancelado" '
                    'en la base de datos.'
                )
            })

    # ---------------------------------------------------------
    # VALIDAR ROLES
    # ---------------------------------------------------------

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

    # ---------------------------------------------------------
    # VALIDAR ESTADOS DEL PROFESIONAL Y DEL PACIENTE
    # ---------------------------------------------------------

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

    # ---------------------------------------------------------
    # VALIDAR ASIGNACIÓN DEL PACIENTE
    # ---------------------------------------------------------

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

    # ---------------------------------------------------------
    # VALIDAR FECHA Y HORA
    # ---------------------------------------------------------

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

    # ---------------------------------------------------------
    # VALIDAR SOLAPAMIENTO CON OTROS TURNOS
    # ---------------------------------------------------------

    @staticmethod
    def validar_solapamiento(
        profesional,
        paciente,
        fecha,
        hora,
        excluir_turno_id=None,
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
                'id_turno',
                'fecha',
                'hora',
                'profesional',
                'paciente',
            )
        )

        # Al editar, no comparar el turno consigo mismo.
        if excluir_turno_id is not None:
            turnos_existentes = turnos_existentes.exclude(
                pk=excluir_turno_id
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

    # ---------------------------------------------------------
    # VALIDAR SOLAPAMIENTOS ENTRE TURNOS DE UNA SOLICITUD
    # ---------------------------------------------------------

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

            if (
                turno_actual['fecha']
                != siguiente_turno['fecha']
            ):
                continue

            inicio_actual = datetime.combine(
                turno_actual['fecha'],
                turno_actual['hora'],
            )

            fin_actual = inicio_actual + timedelta(
                minutes=cls.DURACION_MINUTOS
            )

            inicio_siguiente = datetime.combine(
                siguiente_turno['fecha'],
                siguiente_turno['hora'],
            )

            if inicio_siguiente < fin_actual:
                raise serializers.ValidationError({
                    'turnos': (
                        'Hay horarios que se superponen '
                        'dentro de la solicitud.'
                    )
                })

    # ---------------------------------------------------------
    # OBTENER TURNO PARA EDITAR O CANCELAR
    # ---------------------------------------------------------

    @staticmethod
    def obtener_turno_bloqueado(turno_id):
        try:
            return (
                Turno.objects
                .select_for_update()
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

    # ---------------------------------------------------------
    # VALIDAR QUE EL TURNO PUEDA EDITARSE O CANCELARSE
    # ---------------------------------------------------------

    @classmethod
    def validar_turno_editable(cls, turno):
        if turno.estado.estado not in cls.ESTADOS_EDITABLES:
            raise serializers.ValidationError({
                'estado': (
                    'Solamente se pueden editar o cancelar '
                    'turnos Pendientes o Confirmados.'
                )
            })

    # ---------------------------------------------------------
    # VALIDAR QUIÉN PUEDE GESTIONAR UN TURNO
    # ---------------------------------------------------------

    @classmethod
    def validar_acceso_turno(
        cls,
        *,
        turno,
        usuario,
        nombre_rol,
    ):
        if nombre_rol != 'Profesional':
            return None

        profesional_usuario = cls.obtener_profesional_usuario(
            usuario
        )

        cls.validar_profesional_activo(
            profesional_usuario
        )

        if turno.profesional_id != profesional_usuario.pk:
            raise serializers.ValidationError({
                'detail': (
                    'No tenés permiso para modificar '
                    'turnos de otro profesional.'
                )
            })

        return profesional_usuario

    # ---------------------------------------------------------
    # CREAR UN TURNO
    # ---------------------------------------------------------

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

    # ---------------------------------------------------------
    # CREAR VARIOS TURNOS
    # ---------------------------------------------------------

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
                'turnos': (
                    'Debés indicar al menos un turno.'
                )
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

        if nombre_rol == 'Profesional':
            cls.validar_paciente_asignado(
                profesional,
                paciente,
            )

        # Validar todos los horarios antes de guardar.
        for turno in turnos:
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

        # Detectar conflictos entre los turnos solicitados.
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

    # ---------------------------------------------------------
    # EDITAR UN TURNO
    # ---------------------------------------------------------

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

        turno = cls.obtener_turno_bloqueado(turno_id)

        cls.validar_turno_editable(turno)

        cls.validar_acceso_turno(
            turno=turno,
            usuario=usuario,
            nombre_rol=nombre_rol,
        )

        # Si no se envía otro profesional, conservar el actual.
        if profesional_id is None:
            profesional_id = turno.profesional_id

        try:
            profesional = (
                Profesional.objects
                .select_for_update()
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
                .select_for_update()
                .select_related('estado')
                .get(pk=paciente_id)
            )

        except Paciente.DoesNotExist:
            raise serializers.ValidationError({
                'paciente': 'El paciente indicado no existe.'
            })

        # Un profesional no puede trasladar el turno
        # a otro profesional.
        if (
            nombre_rol == 'Profesional'
            and profesional.pk != turno.profesional_id
        ):
            raise serializers.ValidationError({
                'profesional': (
                    'No podés asignar el turno '
                    'a otro profesional.'
                )
            })

        cls.validar_profesional_activo(profesional)
        cls.validar_paciente_activo(paciente)
        cls.validar_fecha_hora(fecha, hora)

        # Si el usuario es profesional, debe seguir teniendo
        # asignado al paciente.
        #
        # Para otros roles, comprobar la asignación cuando
        # se cambia el paciente o el profesional.
        cambio_de_asignacion = (
            paciente.pk != turno.paciente_id
            or profesional.pk != turno.profesional_id
        )

        if (
            nombre_rol == 'Profesional'
            or cambio_de_asignacion
        ):
            cls.validar_paciente_asignado(
                profesional,
                paciente,
            )

        # Excluir el turno actual evita que colisione consigo
        # mismo al comprobar su nuevo horario.
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

    # ---------------------------------------------------------
    # CANCELAR UN TURNO SIN BORRARLO
    # ---------------------------------------------------------

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

        turno.estado = estado_cancelado

        turno.save(
            update_fields=['estado']
        )

        return turno