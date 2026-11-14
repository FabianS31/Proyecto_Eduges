
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import (
    NotFound,
    PermissionDenied,
    ValidationError,
)

from APIs.turnos.services.turno_service import TurnoService
from pacientes.models import Paciente
from turnos.models import Turno, RegistroSesion
from profesionales.models.asignacion_model import (
    AsignacionProfesional
)


class SesionesService:

    @classmethod
    def puede_consultar_historial(cls, usuario, paciente_id):
        rol = cls.obtener_rol(usuario)
        if rol in ('Administrador', 'SuperAdministrador'):
            return True
        if rol != 'Profesional':
            return False
        return AsignacionProfesional.objects.filter(
            paciente_id=paciente_id,
            profesional__usuario=usuario,
            fecha_inicio__lte=timezone.localdate(),
            fecha_fin__isnull=True,
        ).exists()

    @classmethod
    def listar_historial(cls, usuario, paciente_id):
        # Autorizar antes de consultar registros. Ser autor de una sesión no
        # habilita enumerar las sesiones ajenas del mismo paciente.
        if not cls.puede_consultar_historial(usuario, paciente_id):
            raise PermissionDenied('No tenés autorización para consultar el historial de este paciente.')
        if not Paciente.objects.filter(pk=paciente_id).exists():
            raise NotFound('El paciente solicitado no existe.')
        return Turno.objects.filter(
            paciente_id=paciente_id, registro_sesion__isnull=False,
        ).select_related('profesional', 'registro_sesion').only(
            'id_turno', 'fecha', 'hora', 'profesional__id_profesional',
            'profesional__nombre', 'profesional__apellido',
            'registro_sesion__id_registro_sesion', 'registro_sesion__diagnostico',
        ).order_by('-fecha', '-hora', '-pk')

    @staticmethod
    def obtener_rol(usuario):
        return getattr(
            getattr(usuario, 'rol', None),
            'rol',
            None,
        )

    @staticmethod
    def validar_profesional_autorizado(turno, usuario):
        rol = SesionesService.obtener_rol(usuario)

        if rol == 'SuperAdministrador':
            return None

        if rol != 'Profesional':
            raise PermissionDenied(
                'No tenés permisos para realizar esta operación.'
            )

        try:
            profesional = usuario.profesional
        except Exception:
            raise PermissionDenied(
                'El usuario no está vinculado a un profesional.'
            )

        if profesional.pk != turno.profesional_id:
            raise PermissionDenied(
                'No podés modificar registros de sesión '
                'de otro profesional.'
            )

        return profesional

    @staticmethod
    def obtener_turno(turno_id, bloquear=False):
        turnos = Turno.objects.all()

        if bloquear:
            turnos = turnos.select_for_update()
        else:
            turnos = turnos.select_related(
                'profesional',
                'registro_sesion',
                'paciente',
                'estado',
            )

        try:
            return turnos.get(pk=turno_id)
        except Turno.DoesNotExist:
            raise NotFound(
                'El turno solicitado no existe.'
            )

    @staticmethod
    def validar_turno_no_cancelado(turno):
        if turno.estado.estado.casefold() == 'cancelado':
            raise ValidationError({
                'turno_id': (
                    'No se puede registrar ni modificar '
                    'una sesión de un turno cancelado.'
                )
            })

    @staticmethod
    def validar_turno_habilitado_para_registro(turno):
        estado = turno.estado.estado.casefold()

        if estado == 'cancelado':
            raise ValidationError({
                'turno_id': (
                    'No se puede registrar una sesión '
                    'de un turno Cancelado.'
                )
            })

        if estado == 'ausente':
            raise ValidationError({
                'turno_id': (
                    'No se puede registrar una sesión '
                    'de un turno Ausente.'
                )
            })

        if estado == 'realizado':
            return

        if estado != 'confirmado':
            raise ValidationError({
                'turno_id': (
                    'Solo se puede registrar una sesión '
                    'de un turno Confirmado iniciado o Realizado.'
                )
            })

        if TurnoService.obtener_inicio_turno(turno) > timezone.localtime():
            raise ValidationError({
                'turno_id': (
                    'No se puede registrar una sesión '
                    'antes del inicio del turno.'
                )
            })

    @classmethod
    def listar_turnos_pendientes(
        cls,
        usuario,
        fecha_desde=None,
        fecha_hasta=None,
        paciente_id=None,
    ):
        rol = cls.obtener_rol(usuario)

        if rol == 'SuperAdministrador':
            turnos = Turno.objects.filter(
                registro_sesion__isnull=True,
            )

        elif rol == 'Profesional':
            try:
                profesional = usuario.profesional
            except Exception:
                raise PermissionDenied(
                    'El usuario no está vinculado a un profesional.'
                )

            turnos = Turno.objects.filter(
                profesional=profesional,
                registro_sesion__isnull=True,
            )

        else:
            raise PermissionDenied(
                'No tenés permisos para consultar '
                'los turnos pendientes de registro.'
            )

        turnos = turnos.exclude(
            estado__estado__iexact='Cancelado',
        ).exclude(
            estado__estado__iexact='Ausente',
        )

        if fecha_desde:
            turnos = turnos.filter(fecha__gte=fecha_desde)

        if fecha_hasta:
            turnos = turnos.filter(fecha__lte=fecha_hasta)

        if paciente_id:
            turnos = turnos.filter(paciente_id=paciente_id)

        return (
            turnos
            .select_related('paciente', 'profesional', 'estado')
            .order_by('fecha', 'hora')
        )

    @classmethod
    @transaction.atomic
    def registrar_sesion(
        cls,
        *,
        turno_id,
        trabajo_sesion,
        diagnostico,
        nota_sesion,
        usuario,
    ):
        turno = cls.obtener_turno(
            turno_id,
            bloquear=True,
        )

        cls.validar_turno_habilitado_para_registro(turno)

        cls.validar_profesional_autorizado(
            turno,
            usuario,
        )

        if turno.registro_sesion_id is not None:
            raise ValidationError({
                'turno_id': (
                    'Este turno ya tiene un registro de sesión. '
                    'Debés modificar el registro existente.'
                )
            })

        registro = RegistroSesion.objects.create(
            trabajo_sesion=trabajo_sesion,
            diagnostico=diagnostico,
            nota_sesion=nota_sesion,
        )

        turno.registro_sesion = registro
        turno.save(update_fields=['registro_sesion'])

        return registro

    @classmethod
    @transaction.atomic
    def modificar_sesion(
        cls,
        *,
        turno_id,
        datos,
        usuario,
    ):
        turno = cls.obtener_turno(
            turno_id,
            bloquear=True,
        )

        cls.validar_turno_no_cancelado(turno)

        cls.validar_profesional_autorizado(
            turno,
            usuario,
        )

        if turno.registro_sesion_id is None:
            raise NotFound(
                'Este turno todavía no tiene '
                'un registro de sesión.'
            )

        registro = RegistroSesion.objects.select_for_update().get(
            pk=turno.registro_sesion_id,
        )

        campos_permitidos = {
            'trabajo_sesion',
            'diagnostico',
            'nota_sesion',
        }

        campos_recibidos = set(datos.keys())

        if not campos_recibidos.intersection(campos_permitidos):
            raise ValidationError({
                'detail': (
                    'Debés enviar al menos un campo '
                    'para modificar el registro.'
                )
            })

        for campo in campos_recibidos:
            if campo not in campos_permitidos:
                raise ValidationError({
                    campo: 'Este campo no se puede modificar.'
                })

            setattr(registro, campo, datos[campo])

        registro.save(
            update_fields=list(campos_recibidos),
        )

        return registro

    @classmethod
    def obtener_sesion(cls, turno_id, usuario):
        turno = cls.obtener_turno(turno_id)

        if turno.registro_sesion_id is None:
            raise NotFound(
                'Este turno todavía no tiene '
                'un registro de sesión.'
            )

        rol = cls.obtener_rol(usuario)

        # Administrador: acceso únicamente al diagnóstico.
        if rol == 'Administrador':
            return turno.registro_sesion, False

        # SuperAdministrador: acceso completo.
        if rol == 'SuperAdministrador':
            return turno.registro_sesion, True

        if rol != 'Profesional':
            raise PermissionDenied(
                'No tenés permisos para consultar este registro.'
            )

        try:
            profesional = usuario.profesional
        except Exception:
            raise PermissionDenied(
                'El usuario no está vinculado a un profesional.'
            )

        # El profesional del turno conserva el acceso completo.
        if profesional.pk == turno.profesional_id:
            return turno.registro_sesion, True

        # Un profesional nuevo asignado al paciente puede ver
        # únicamente el diagnóstico de los registros históricos.
        if cls.puede_consultar_historial(usuario, turno.paciente_id):
            return turno.registro_sesion, False

        raise PermissionDenied(
            'No tenés autorización para consultar '
            'el registro de sesión de este paciente.'
        )
