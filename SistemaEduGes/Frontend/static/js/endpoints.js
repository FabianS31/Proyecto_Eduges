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
};

// ------------------------------------------------------------
// Sin API todavía: pacientes, turnos y catálogos
// Devuelven lo mismo que la API sin datos (listas vacías) y, al guardar, avisan
// que no se puede. Cuando el backend tenga cada endpoint, se reemplaza el cuerpo
// de la función por la llamada real (api.get / api.post) y las pantallas no cambian.
// ------------------------------------------------------------
const sinDatos = async () => [];

const sinApiParaGuardar = (que) => Promise.reject(new ApiError(501, {
    detail: `Todavía no se pueden guardar ${que}: falta la API en el servidor.`,
}));

export const pacientes = {
    // Pacientes asignados al profesional logueado: [{ id, nombre, apellido, dni, cud_vencimiento }]
    mios: sinDatos,

    // Sugerencias del buscador: mismo formato que mios()
    buscar: (texto, opciones) => sinDatos(texto, opciones),

    // Pacientes del profesional con CUD vencido o por vencer: [{ id, nombre, apellido, cud_vencimiento }]
    cudPorVencer: sinDatos,

    crear: () => sinApiParaGuardar('pacientes'),
};

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
