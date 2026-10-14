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
    login: (usuario, password, recordar = false) =>
        api.post('/auth/login/', { usuario, password, recordar }, { redirigirSi401: false }),

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
    // [{ id_turno, fecha, hora: "HH:MM:SS", paciente_id, profesional_id, estado: "Pendiente" }]
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
};

// ------------------------------------------------------------
// Sin API todavía: catálogos
// Devuelven lo mismo que la API sin datos (listas vacías). Cuando el backend tenga
// cada endpoint, se reemplaza por la llamada real (api.get) y las pantallas no cambian.
// ------------------------------------------------------------
const sinDatos = async () => [];

export const catalogos = {
    obrasSociales: sinDatos,   // [{ id, nombre }]
    parentescos: sinDatos,     // [{ id, nombre }]
};
