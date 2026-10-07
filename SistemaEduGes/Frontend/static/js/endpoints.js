// ============================================================
// EduGes - Endpoints de la API
// Una función por endpoint del backend. Es el único lugar del frontend
// donde aparecen las rutas: si el backend cambia una ruta, se cambia acá.
//
// Todas devuelven una Promise con el JSON de la respuesta y lanzan ApiError
// ante un error. El último parámetro "opciones" es opcional y se pasa tal cual
// a request() (ej.: { signal } para cancelar una request).
// ============================================================

import { api, ApiError } from './api.js';
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
// Sin API todavía: turnos y catálogos
// Devuelven lo mismo que la API sin datos (listas vacías) y, al guardar, avisan
// que no se puede. Cuando el backend tenga cada endpoint, se reemplaza el cuerpo
// de la función por la llamada real (api.get / api.post) y las pantallas no cambian.
// ------------------------------------------------------------
const sinDatos = async () => [];

const sinApiParaGuardar = (que) => Promise.reject(new ApiError(501, {
    detail: `Todavía no se pueden guardar ${que}: falta la API en el servidor.`,
}));

export const turnos = {
    // Turnos del profesional logueado en una fecha:
    // [{ id, fecha, hora, estado: { id, nombre }, paciente: { id, nombre, apellido }, registrado }]
    delDia: (fecha, opciones) => sinDatos(fecha, opciones),

    // Turnos realizados del profesional que todavía no tienen registro de sesión: mismo formato
    sinRegistrar: sinDatos,

    crear: () => sinApiParaGuardar('turnos'),
};

export const catalogos = {
    obrasSociales: sinDatos,   // [{ id, nombre }]
    parentescos: sinDatos,     // [{ id, nombre }]
};
