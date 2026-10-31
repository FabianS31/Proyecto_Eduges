// ============================================================
// EduGes - Endpoints de la API
// Una función por endpoint del backend. Es el único lugar del frontend
// donde aparecen las rutas: si el backend cambia una ruta, se cambia acá.
//
// Todas devuelven una Promise con el JSON de la respuesta y lanzan ApiError
// ante un error. El último parámetro "opciones" es opcional y se pasa tal cual
// a request() (ej.: { signal } para cancelar una request).
// ============================================================

import { api } from './api.js';
import { ESTADO_PACIENTE } from './constantes.js';

// ------------------------------------------------------------
// Autenticación — /api/auth/
// ------------------------------------------------------------
export const auth = {
    csrf: () => api.get('/auth/csrf/', { redirigirSi401: false }),

    // 200 → { id, usuario, rol }. 400 → credenciales incorrectas. 429 → bloqueado ({ reintentar_en })
    // La sesión se cierra al cerrar el navegador o tras 20 minutos sin uso.
    login: (usuario, password) =>
        api.post('/auth/login/', { usuario, password }, { redirigirSi401: false }),

    logout: () => api.post('/auth/logout/'),

    // { id, usuario, rol: { id, nombre }, profesional: { id, nombre, apellido, especialidad } | null, permisos: [...] }
    me: (opciones) => api.get('/auth/me/', opciones),

    // La API no pide confirmación: que las dos contraseñas coincidan se valida en el formulario
    cambiarPassword: (passwordActual, passwordNueva) =>
        api.post('/auth/cambiar-password/', {
            password_actual: passwordActual,
            password_nueva: passwordNueva,
        }),
};

// ------------------------------------------------------------
// Profesionales — /api/profesionales/
// ------------------------------------------------------------
export const profesionales = {
    // Array con todos los profesionales (sin paginación ni filtros en el servidor)
    listar: (opciones) => api.get('/profesionales/', opciones),

    // Crea un nuevo profesional con su usuario y contraseña
    crear: (datos) => api.post('/profesionales/', datos),

    // Cambia solo los campos enviados y devuelve el profesional actualizado.
    // Solo el SuperAdministrador tiene permiso (403 para el resto). 400 → errores por campo (ej.: matricula).
    actualizar: (id, datos) => api.patch(`/profesionales/${id}/`, datos),
};

// ------------------------------------------------------------
// Pacientes — /api/pacientes/
// ------------------------------------------------------------
// La API devuelve todos los pacientes juntos (sin paginación ni búsqueda en el servidor):
// se piden una sola vez por página y se reutilizan (cantidad, CUD, buscador, listado).
let pacientesEnMemoria = null;

export const pacientes = {
    // Un profesional recibe solo los pacientes con una asignación vigente con él;
    // los administradores, todos. Ordenados por apellido y nombre:
    // [{ id_paciente, nombre, apellido, dni, fecha_nacimiento, direccion, mail, consentimiento,
    //    cud_numero, cud_vencimiento, obra_social, numero_afiliado, estado }]
    // (obra_social y estado son IDs)
    listar() {
        pacientesEnMemoria ??= api.get('/pacientes/').catch((error) => {
            pacientesEnMemoria = null;   // si falló, el próximo intento vuelve a pedirlos
            throw error;
        });
        return pacientesEnMemoria;
    },

    // Alta: si la crea un profesional, el paciente queda asignado a él. El estado lo exige
    // la API, así que todo paciente nuevo entra como Activo. 400 → errores por campo (ej.: dni).
    async crear(datos) {
        const creado = await api.post('/pacientes/', { ...datos, estado: ESTADO_PACIENTE.ACTIVO });
        pacientesEnMemoria = null;
        return creado;
    },
};

// ------------------------------------------------------------
// Turnos — /api/turnos/
// ------------------------------------------------------------
// La API devuelve todos los turnos juntos (sin filtros por fecha en el servidor):
// se piden una vez por página y se reutilizan; se vuelven a pedir después de un cambio.
// Reglas que valida la API: hasta 30 días hacia adelante, nunca un horario pasado,
// duración fija de 1 hora, sin superponerse con otro turno del profesional ni del paciente,
// y solo con pacientes asignados al profesional.
let turnosEnMemoria = null;

async function cambiarTurnos(llamada) {
    const resultado = await llamada();
    turnosEnMemoria = null;
    return resultado;
}

export const turnos = {
    // Un profesional recibe solo sus turnos; los administradores, todos. Ordenados por fecha y hora:
    // [{ id_turno, fecha, hora: "HH:MM:SS", paciente_id, profesional_id,
    //    estado: { ID_EstadoTurno: 1, Estado: "Pendiente" } }]
    listar() {
        turnosEnMemoria ??= api.get('/turnos/').catch((error) => {
            turnosEnMemoria = null;
            throw error;
        });
        return turnosEnMemoria;
    },

    // Un turno:    { paciente, fecha, hora }
    // Varios (todas las fechas o ninguna): { paciente, turnos: [{ fecha, hora }, …] }
    // Un administrador además indica { profesional }. 400 → errores por campo (fecha, hora, paciente, turnos).
    crear: (datos) => cambiarTurnos(() => api.post('/turnos/', datos)),

    // Solo turnos Pendientes o Confirmados, propios
    reprogramar: (id, { fecha, hora }) => cambiarTurnos(() => api.patch(`/turnos/${id}/`, { fecha, hora })),

    // No borra: lo pasa a Cancelado
    cancelar: (id) => cambiarTurnos(() => api.delete(`/turnos/${id}/`)),

    // Cambios permitidos (los valida la API): Pendiente → Confirmado; Confirmado → Ausente
    // (desde la hora del turno) o Realizado (pasada la hora de duración); Ausente → Realizado.
    // Ausente y Realizado: solo el profesional del turno o el SuperAdministrador.
    cambiarEstado: (id, estado) => cambiarTurnos(() => api.patch(`/turnos/${id}/estado/`, { ID_EstadoTurno: estado })),
};

// ------------------------------------------------------------
// Tutores (APIs/tutores/)
// ------------------------------------------------------------
export const tutores = {
    listar: (parametros, opciones = {}) => api.get('/tutores/', { ...opciones, parametros }),
    crear: (datos) => api.post('/tutores/', datos),
    obtener: (id) => api.get(`/tutores/${id}/`),
    actualizar: (id, datos) => api.patch(`/tutores/${id}/`, datos),
    actualizarRelacion: (idRelacion, datos) => api.patch(`/tutores/relaciones/${idRelacion}/`, datos),
    darDeBajaRelacion: (idRelacion) => api.delete(`/tutores/relaciones/${idRelacion}/`),
};

// ------------------------------------------------------------
// Sesiones clinicas (APIs/sesiones/)
// ------------------------------------------------------------
export const sesiones = {
    // Consulta turnos pendientes de registro de sesion (excluye cancelados)
    // Filtros opcionales: { fecha_desde, fecha_hasta, paciente_id }
    pendientes: (filtros = {}, opciones = {}) =>
        api.get('/sesiones/pendientes/', { ...opciones, parametros: filtros }),

    // Consulta el registro de sesion asociado al ID del turno
    // Profesional/SuperAdmin reciben { id, trabajo_sesion, resultado, nota_especial }
    // Administrador recibe solo { id, trabajo_sesion }
    obtener: (turnoId, opciones = {}) =>
        api.get(`/sesiones/${turnoId}/`, opciones),

    // Crea el registro para un turno:
    // datos: { turno_id, trabajo_sesion, resultado, nota_especial }
    crear: (datos) => api.post('/sesiones/', datos),

    // Modifica uno o varios campos del registro de sesion:
    // datos: { trabajo_sesion?, resultado?, nota_especial? }
    actualizar: (turnoId, datos) => api.patch(`/sesiones/${turnoId}/`, datos),
};

// ------------------------------------------------------------
// Sin API todavía: catálogos
// Devuelven lo mismo que la API sin datos (listas vacías). Cuando el backend tenga
// cada endpoint, se reemplaza por la llamada real (api.get) y las pantallas no cambian.
// ------------------------------------------------------------
// ------------------------------------------------------------
// Obras Sociales — /api/obras-sociales/
// ------------------------------------------------------------
export const obrasSociales = {
    // Lista todas las obras sociales o filtra por estado (?estado=1 para activas)
    listar: (filtros = {}, opciones = {}) =>
        api.get('/obras-sociales/', { ...opciones, parametros: filtros }),

    obtener: (id, opciones = {}) =>
        api.get(`/obras-sociales/${id}/`, opciones),

    // Crea una nueva obra social ({ nombre, contacto?, mail?, web? })
    crear: (datos) => api.post('/obras-sociales/', datos),

    // Modifica datos o estado ({ estado_id: 1 | 2, nombre?, contacto?, mail?, web? })
    actualizar: (id, datos) => api.patch(`/obras-sociales/${id}/`, datos),
};

// ------------------------------------------------------------
// Reportes (APIs/reportes/)
// ------------------------------------------------------------
export const reportes = {
    turnos: (filtros = {}, opciones = {}) =>
        api.get('/reportes/turnos/', { ...opciones, parametros: filtros }),
    pacientes: (filtros = {}, opciones = {}) =>
        api.get('/reportes/pacientes/', { ...opciones, parametros: filtros }),
    profesionales: (filtros = {}, opciones = {}) =>
        api.get('/reportes/profesionales/', { ...opciones, parametros: filtros }),
};

const sinDatos = async () => [];

export const catalogos = {
    // Consulta la API si está disponible; filtra solo las activas (estado: 1) para combos y formularios
    obrasSociales: async () => {
        try {
            return await api.get('/obras-sociales/', { parametros: { estado: 1 } });
        } catch {
            return [
                { id: 1, nombre: 'Obra Social de Prueba' },
            ];
        }
    },
    parentescos: async () => {
        try {
            return await api.get('/tutores/parentescos/');
        } catch {
            return [
                { id: 1, nombre: 'Padre' },
                { id: 2, nombre: 'Tío/a' },
                { id: 3, nombre: 'Tutor Legal' },
                { id: 4, nombre: 'Hermano/a' },
                { id: 5, nombre: 'Madre' },
                { id: 6, nombre: 'Abuelo/a' },
            ];
        }
    },
    especialidades: async () => [
        { id: 1, nombre: 'Psicopedagogo/a' },
    ],
};
