from .turno_consultas import ConsultasTurnoMixin
from .turno_estados import EstadosTurnoMixin
from .turno_operaciones import OperacionesTurnoMixin
from .turno_reasignaciones import ReasignacionesTurnoMixin
from .turno_validaciones import ValidacionesTurnoMixin


class TurnoService(
    ValidacionesTurnoMixin,
    ConsultasTurnoMixin,
    EstadosTurnoMixin,
    OperacionesTurnoMixin,
    ReasignacionesTurnoMixin,
):
    """Punto de entrada único para las operaciones del módulo de turnos."""

    DURACION_MINUTOS = 40
    ANIOS_ANTICIPACION = 1

    ESTADOS_EDITABLES = (
        'Pendiente',
        'Confirmado',
    )

    ROLES_AUTORIZADOS = (
        'Profesional',
        'Administrador',
        'SuperAdministrador',
    )

    TRANSICIONES_PERMITIDAS = {
        'Pendiente': ('Confirmado', 'Cancelado'),
        'Confirmado': ('Cancelado', 'Ausente', 'Realizado'),
        'Ausente': ('Realizado',),
        'Realizado': (),
        'Cancelado': (),
    }