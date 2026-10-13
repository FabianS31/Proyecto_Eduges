// ============================================================
// EduGes - Configuración del frontend
// Único lugar donde se cambia el comportamiento global del cliente de la API.
// ============================================================

export const CONFIG = {
    // Prefijo de todas las rutas de la API
    API_BASE: '/api',

    // Tiempo máximo de espera de una request antes de darla por fallida
    TIMEOUT_MS: 15000,

    // Página a la que se redirige cuando la sesión no existe o expiró (401)
    LOGIN_URL: '/login/',
};
