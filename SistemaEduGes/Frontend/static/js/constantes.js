// ============================================================
// EduGes - Constantes compartidas
// IDs fijos de catálogos y códigos de permiso (docs/api-contrato.md §2 y §4).
// Si cambian en la BD, hay que cambiarlos acá.
// ============================================================

export const ESTADO_TURNO = Object.freeze({
    PENDIENTE: 1,
    CONFIRMADO: 2,
    CANCELADO: 3,
    REALIZADO: 4,
});

// A qué estados puede pasar un turno desde cada estado (§7)
export const TRANSICIONES_TURNO = Object.freeze({
    [ESTADO_TURNO.PENDIENTE]: [ESTADO_TURNO.CONFIRMADO, ESTADO_TURNO.CANCELADO],
    [ESTADO_TURNO.CONFIRMADO]: [ESTADO_TURNO.REALIZADO, ESTADO_TURNO.CANCELADO],
    [ESTADO_TURNO.CANCELADO]: [],
    [ESTADO_TURNO.REALIZADO]: [],
});

export const ESTADO_PACIENTE = Object.freeze({
    ACTIVO: 1,
    INACTIVO: 2,
});

export const ROL = Object.freeze({
    ADMINISTRADOR: 1,
    PROFESIONAL: 2,
});

export const PERMISO = Object.freeze({
    DASHBOARD_VER: 'dashboard.ver',
    PACIENTES_VER: 'pacientes.ver',
    PACIENTES_EDITAR: 'pacientes.editar',
    TURNOS_VER: 'turnos.ver',
    TURNOS_EDITAR: 'turnos.editar',
    SESIONES_REGISTRAR: 'sesiones.registrar',
    SESIONES_VER: 'sesiones.ver',
    PROFESIONALES_VER: 'profesionales.ver',
    PROFESIONALES_EDITAR: 'profesionales.edit',
    OBRAS_SOCIALES_EDITAR: 'obras_sociales.edit',
    USUARIOS_ADMIN: 'usuarios.admin',
});

// Días de anticipación con que un CUD se considera "por vencer"
export const DIAS_AVISO_CUD = 60;

export const CUD_ESTADO = Object.freeze({
    VIGENTE: 'vigente',
    POR_VENCER: 'por_vencer',
    VENCIDO: 'vencido',
});
