// ============================================================
// EduGes - Constantes compartidas
// Códigos de permiso (tabla "permisos", los devuelve /api/auth/me/) e IDs fijos de catálogos.
// Si cambian en la BD, hay que cambiarlos acá.
// ============================================================

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

// IDs de la tabla "estados_pacientes"
export const ESTADO_PACIENTE = Object.freeze({
    ACTIVO: 1,
    INACTIVO: 2,
});

// IDs de la tabla "estados_turnos". La API de turnos devuelve el estado como
// { ID_EstadoTurno, Estado } y para cambiarlo recibe { ID_EstadoTurno }.
export const ESTADO_TURNO = Object.freeze({
    PENDIENTE: 1,
    CONFIRMADO: 2,
    CANCELADO: 3,
    REALIZADO: 4,
    AUSENTE: 5,
});

// Reglas de la API de turnos (APIs/turnos/services/turno_service.py)
export const TURNO_DIAS_ANTICIPACION = 30;
export const TURNO_DURACION_MINUTOS = 60;

// Un CUD que vence dentro de estos meses se muestra como "por vencer" (ERS: aviso con 3 meses de anticipación)
export const MESES_AVISO_CUD = 3;
