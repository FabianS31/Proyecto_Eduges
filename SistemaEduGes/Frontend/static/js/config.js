// ============================================================
// EduGes - Configuración del frontend
// Único lugar donde se cambia el comportamiento global del cliente de la API.
// ============================================================

export const CONFIG = {
    // Prefijo de todas las rutas de la API (ver docs/api-contrato.md §1.1)
    API_BASE: '/api',

    // true  → las requests las responde la API simulada (static/mocks/servidor.js)
    // false → las requests van al backend Django real
    USE_MOCKS: true,

    // Demora artificial de la API simulada, para poder ver los estados de carga
    MOCK_LATENCIA_MS: 300,

    // false → la API simulada arranca SIN sesión, como la real: hay que pasar por /login/
    // true  → atajo de desarrollo: se entra directo con el rol de ?rol=admin / ?rol=profesional
    //         (o MOCK_ROL_POR_DEFECTO), sin loguearse. No usar para mostrar el sistema.
    MOCK_SESION_AUTOMATICA: false,

    // Rol del atajo anterior si no se indica otro en la URL
    MOCK_ROL_POR_DEFECTO: 'admin',

    // Tiempo máximo de espera de una request antes de darla por fallida
    TIMEOUT_MS: 15000,

    // Página a la que se redirige cuando la sesión no existe o expiró (401)
    LOGIN_URL: '/login/',
};

// ------------------------------------------------------------
// Rol de la API simulada
// Se elige con ?rol=admin o ?rol=profesional en la URL y queda guardado
// en la pestaña, así no hay que repetirlo en cada página.
// ------------------------------------------------------------
const ROLES_MOCK = ['admin', 'profesional'];
const CLAVE_ROL_MOCK = 'eduges.mock.rol';

export function obtenerRolMock() {
    const rolUrl = new URLSearchParams(window.location.search).get('rol');

    try {
        if (ROLES_MOCK.includes(rolUrl)) {
            sessionStorage.setItem(CLAVE_ROL_MOCK, rolUrl);
            return rolUrl;
        }
        const rolGuardado = sessionStorage.getItem(CLAVE_ROL_MOCK);
        if (ROLES_MOCK.includes(rolGuardado)) {
            return rolGuardado;
        }
    } catch {
        // sessionStorage bloqueado (modo privado, permisos): se usa la URL o el valor por defecto
        if (ROLES_MOCK.includes(rolUrl)) {
            return rolUrl;
        }
    }

    return CONFIG.MOCK_ROL_POR_DEFECTO;
}

// La API simulada la usa al hacer login, para que el rol elegido se mantenga en la pestaña
export function guardarRolMock(rol) {
    if (!ROLES_MOCK.includes(rol)) {
        return;
    }
    try {
        sessionStorage.setItem(CLAVE_ROL_MOCK, rol);
    } catch {
        // sessionStorage bloqueado: el rol dura solo hasta recargar
    }
}
