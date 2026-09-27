// ============================================================
// EduGes - Endpoints de la API
// Una función por endpoint de docs/api-contrato.md. Es el único lugar
// del frontend donde aparecen las rutas: si el contrato cambia, se cambia acá.
//
// Todas devuelven una Promise con el JSON de la respuesta y lanzan ApiError
// ante un error. El último parámetro "opciones" es opcional y se pasa tal cual
// a request() (ej.: { signal } para cancelar una búsqueda).
// ============================================================

import { api } from './api.js';
import { ESTADO_PACIENTE, ESTADO_TURNO } from './constantes.js';

// ------------------------------------------------------------
// §3 Autenticación
// ------------------------------------------------------------
export const auth = {
    csrf: () => api.get('/auth/csrf/', { redirigirSi401: false }),

    login: (usuario, password, recordar = false) =>
        api.post('/auth/login/', { usuario, password, recordar }, { redirigirSi401: false }),

    logout: () => api.post('/auth/logout/'),

    me: (opciones) => api.get('/auth/me/', opciones),

    cambiarPassword: (passwordActual, passwordNuevo, confirmacion) =>
        api.post('/auth/cambiar-password/', {
            password_actual: passwordActual,
            password_nuevo: passwordNuevo,
            password_nuevo_confirmacion: confirmacion,
        }),
};

// ------------------------------------------------------------
// §4 Catálogos (se piden una sola vez y quedan en memoria)
// ------------------------------------------------------------
let catalogosEnMemoria = null;

export const catalogos = {
    obtener() {
        if (!catalogosEnMemoria) {
            catalogosEnMemoria = api.get('/catalogos/').catch((error) => {
                catalogosEnMemoria = null;
                throw error;
            });
        }
        return catalogosEnMemoria;
    },

    // Llamar después de modificar un catálogo (ej.: alta de obra social)
    invalidar() {
        catalogosEnMemoria = null;
    },
};

// ------------------------------------------------------------
// §5 Dashboard
// ------------------------------------------------------------
export const dashboard = {
    resumen: (fecha, opciones) => api.get('/dashboard/resumen/', { ...opciones, parametros: { fecha } }),
};

// ------------------------------------------------------------
// §6 Pacientes y tutores
// ------------------------------------------------------------
export const pacientes = {
    // filtros: { q, estado, profesional, obra_social, cud_estado, ordering, page, page_size }
    listar: (filtros = {}, opciones) => api.get('/pacientes/', { ...opciones, parametros: filtros }),

    obtener: (id, opciones) => api.get(`/pacientes/${id}/`, opciones),

    crear: (datos) => api.post('/pacientes/', datos),

    actualizar: (id, datos) => api.patch(`/pacientes/${id}/`, datos),

    darDeBaja: (id) => api.patch(`/pacientes/${id}/`, { estado_id: ESTADO_PACIENTE.INACTIVO }),

    reactivar: (id) => api.patch(`/pacientes/${id}/`, { estado_id: ESTADO_PACIENTE.ACTIVO }),

    // { dias, limite }
    cudPorVencer: (filtros = {}, opciones) =>
        api.get('/pacientes/cud-por-vencer/', { ...opciones, parametros: filtros }),

    tutores: {
        listar: (pacienteId, opciones) => api.get(`/pacientes/${pacienteId}/tutores/`, opciones),

        // datos: { tutor_id, parentesco_id, responsable_principal }
        //    o   { tutor: {...datos del tutor nuevo}, parentesco_id, responsable_principal }
        vincular: (pacienteId, datos) => api.post(`/pacientes/${pacienteId}/tutores/`, datos),

        actualizarVinculo: (pacienteId, vinculoId, datos) =>
            api.patch(`/pacientes/${pacienteId}/tutores/${vinculoId}/`, datos),

        desvincular: (pacienteId, vinculoId) => api.delete(`/pacientes/${pacienteId}/tutores/${vinculoId}/`),
    },
};

export const tutores = {
    buscar: (q, opciones) => api.get('/tutores/', { ...opciones, parametros: { q } }),

    actualizar: (id, datos) => api.patch(`/tutores/${id}/`, datos),
};

// ------------------------------------------------------------
// §7 Turnos y registro de sesión
// ------------------------------------------------------------
export const turnos = {
    // filtros: { fecha } | { desde, hasta } | { paciente }, más { profesional, estado: [1, 2] }
    listar: (filtros = {}, opciones) => api.get('/turnos/', { ...opciones, parametros: filtros }),

    delDia: (fecha, filtros = {}, opciones) =>
        api.get('/turnos/', { ...opciones, parametros: { ...filtros, fecha } }),

    obtener: (id, opciones) => api.get(`/turnos/${id}/`, opciones),

    crear: (datos) => api.post('/turnos/', datos),

    // Reprogramar: { fecha, hora_inicio, hora_fin, profesional_id }
    actualizar: (id, datos) => api.patch(`/turnos/${id}/`, datos),

    cambiarEstado: (id, estadoId) => api.patch(`/turnos/${id}/`, { estado_id: estadoId }),

    confirmar: (id) => turnos.cambiarEstado(id, ESTADO_TURNO.CONFIRMADO),

    cancelar: (id) => turnos.cambiarEstado(id, ESTADO_TURNO.CANCELADO),
};

export const sesiones = {
    obtener: (turnoId, opciones) => api.get(`/turnos/${turnoId}/sesion/`, opciones),

    registrar: (turnoId, notaClinica, marcarRealizado = true) =>
        api.post(`/turnos/${turnoId}/sesion/`, { nota_clinica: notaClinica, marcar_realizado: marcarRealizado }),

    actualizar: (turnoId, notaClinica) => api.patch(`/turnos/${turnoId}/sesion/`, { nota_clinica: notaClinica }),
};

// ------------------------------------------------------------
// §8 Profesionales, asignaciones y obras sociales
// ------------------------------------------------------------
export const profesionales = {
    // filtros: { q, especialidad, estado, page, page_size }
    listar: (filtros = {}, opciones) => api.get('/profesionales/', { ...opciones, parametros: filtros }),

    obtener: (id, opciones) => api.get(`/profesionales/${id}/`, opciones),

    // datos incluye usuario: { usuario, password }
    crear: (datos) => api.post('/profesionales/', datos),

    actualizar: (id, datos) => api.patch(`/profesionales/${id}/`, datos),
};

export const asignaciones = {
    // filtros: { paciente, profesional, vigentes: true }
    listar: (filtros = {}, opciones) => api.get('/asignaciones/', { ...opciones, parametros: filtros }),

    crear: (pacienteId, profesionalId, fechaInicio) =>
        api.post('/asignaciones/', {
            paciente_id: pacienteId,
            profesional_id: profesionalId,
            fecha_inicio: fechaInicio,
        }),

    actualizar: (id, datos) => api.patch(`/asignaciones/${id}/`, datos),

    finalizar: (id, fechaFin) => api.patch(`/asignaciones/${id}/`, { fecha_fin: fechaFin }),
};

export const obrasSociales = {
    // filtros: { estado }
    listar: (filtros = {}, opciones) => api.get('/obras-sociales/', { ...opciones, parametros: filtros }),

    obtener: (id, opciones) => api.get(`/obras-sociales/${id}/`, opciones),

    crear: async (datos) => {
        const creada = await api.post('/obras-sociales/', datos);
        catalogos.invalidar();
        return creada;
    },

    actualizar: async (id, datos) => {
        const actualizada = await api.patch(`/obras-sociales/${id}/`, datos);
        catalogos.invalidar();
        return actualizada;
    },
};

// ------------------------------------------------------------
// §9 Usuarios (solo Administrador)
// ------------------------------------------------------------
export const usuarios = {
    listar: (opciones) => api.get('/usuarios/', opciones),

    crear: (usuario, password, rolId) => api.post('/usuarios/', { usuario, password, rol_id: rolId }),

    actualizar: (id, datos) => api.patch(`/usuarios/${id}/`, datos),

    resetearPassword: (id, passwordNuevo) =>
        api.post(`/usuarios/${id}/resetear-password/`, { password_nuevo: passwordNuevo }),
};
