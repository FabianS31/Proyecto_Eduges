
from django.db import transaction
from rest_framework.exceptions import (
    NotFound,
    PermissionDenied,
    ValidationError,
)

from turnos.models import Turno, RegistroSesion


class SesionesService:
    """
    Reglas de negocio para los registros de sesión.

    Profesional:
    - Consulta los registros de sus propios turnos.
    - Puede crear y modificar sus registros.

    Administrador:
    - Puede consultar los registros para elaborar informes.
    - No puede crear ni modificar registros.

    SuperAdministrador:
    - Puede consultar, crear y modificar cualquier registro.
    """

    @staticmethod
    def obtener_rol(usuario):
        return getattr(
            getattr(usuario, 'rol', None),
            'rol',
            None,
        )

    # --------------------------------------------------
    # VALIDAR AL PROFESIONAL ASIGNADO AL TURNO
    # --------------------------------------------------

    @staticmethod
    def validar_profesional_autorizado(turno, usuario):
        rol = SesionesService.obtener_rol(usuario)

        # El SuperAdministrador tiene acceso completo.
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
                'No podés acceder al registro de sesión '
                'de otro profesional.'
            )

        return profesional

    # --------------------------------------------------
    # VALIDAR PERMISOS DE LECTURA
    # --------------------------------------------------

    @classmethod
    def validar_acceso_lectura(cls, turno, usuario):
        rol = cls.obtener_rol(usuario)

        if rol in ('Administrador', 'SuperAdministrador'):
            return

        if rol == 'Profesional':
            cls.validar_profesional_autorizado(
                turno,
                usuario,
            )
            return

        raise PermissionDenied(
            'No tenés permisos para consultar este registro.'
        )

    # --------------------------------------------------
    # OBTENER TURNO
    # --------------------------------------------------

    @staticmethod
    def obtener_turno(turno_id, bloquear=False):
        turnos = Turno.objects.all()

        if bloquear:
            turnos = turnos.select_for_update()
        else:
            turnos = turnos.select_related(
                'profesional',
                'registro_sesion',
            )

        try:
            return turnos.get(pk=turno_id)
        except Turno.DoesNotExist:
            raise NotFound(
                'El turno solicitado no existe.'
            )

    # --------------------------------------------------
    # VALIDAR QUE EL TURNO NO ESTÉ CANCELADO
    # --------------------------------------------------

    @staticmethod
    def validar_turno_no_cancelado(turno):
        if turno.estado.estado.casefold() == 'cancelado':
            raise ValidationError({
                'turno_id': (
                    'No se puede registrar ni modificar '
                    'una sesión de un turno cancelado.'
                )
            })

    # --------------------------------------------------
    # LISTAR TURNOS SIN REGISTRO DE SESIÓN
    # --------------------------------------------------

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

    # --------------------------------------------------
    # REGISTRAR UNA SESIÓN
    # --------------------------------------------------

    @classmethod
    @transaction.atomic
    def registrar_sesion(
        cls,
        *,
        turno_id,
        trabajo_sesion,
        resultado,
        nota_especial,
        usuario,
    ):
        turno = cls.obtener_turno(
            turno_id,
            bloquear=True,
        )

        # No se permite registrar sesiones de turnos cancelados.
        cls.validar_turno_no_cancelado(turno)

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
            resultado=resultado,
            nota_especial=nota_especial,
        )

        turno.registro_sesion = registro
        turno.save(update_fields=['registro_sesion'])

        return registro

    # --------------------------------------------------
    # MODIFICAR UN REGISTRO EXISTENTE
    # --------------------------------------------------

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

        # No se permite modificar sesiones de turnos cancelados.
        cls.validar_turno_no_cancelado(turno)

        # Solo el profesional asignado o el
        # SuperAdministrador pueden modificar.
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
            'resultado',
            'nota_especial',
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

    # --------------------------------------------------
    # OBTENER UN REGISTRO EXISTENTE
    # --------------------------------------------------

    @classmethod
    def obtener_sesion(cls, turno_id, usuario):
        turno = cls.obtener_turno(turno_id)

        cls.validar_acceso_lectura(
            turno,
            usuario,
        )

        if turno.registro_sesion_id is None:
            raise NotFound(
                'Este turno todavía no tiene '
                'un registro de sesión.'
            )

        return turno.registro_sesion