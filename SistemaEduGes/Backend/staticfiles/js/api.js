// ============================================================
// EduGes - Cliente HTTP de la API REST
// Todas las pantallas hablan con el backend a través de este módulo.
// Errores con el formato de Django REST Framework ({ detail }, { campo: [...] }, { non_field_errors }).
// ============================================================

import { CONFIG } from './config.js';

const METODOS_CON_CSRF = ['POST', 'PUT', 'PATCH', 'DELETE'];

const MENSAJES_POR_ESTADO = {
    0: 'No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo.',
    400: 'Revisá los datos ingresados.',
    401: 'Tu sesión expiró. Volvé a iniciar sesión.',
    403: 'No tenés permiso para realizar esta acción.',
    404: 'El recurso solicitado no existe.',
    405: 'Operación no permitida.',
    409: 'La operación entra en conflicto con datos existentes.',
    429: 'Demasiados intentos. Esperá un momento y volvé a intentar.',
    500: 'Ocurrió un error en el servidor. Intentá de nuevo más tarde.',
};

// Claves del cuerpo de error que no corresponden a un campo del formulario
const CLAVES_NO_CAMPO = ['detail', 'codigo', 'reintentar_en', 'non_field_errors'];

// DRF anida los errores de serializers anidados: { usuario: { usuario: ['...'] } }.
// Se aplanan con punto para poder ubicarlos en el formulario: { 'usuario.usuario': ['...'] }
function aplanarErrores(clave, valor, destino) {
    if (Array.isArray(valor) && valor.every((v) => typeof v !== 'object' || v === null)) {
        destino[clave] = valor.map(String);
    } else if (Array.isArray(valor)) {
        valor.forEach((v, i) => aplanarErrores(`${clave}.${i}`, v, destino));
    } else if (valor && typeof valor === 'object') {
        for (const [subclave, subvalor] of Object.entries(valor)) {
            aplanarErrores(`${clave}.${subclave}`, subvalor, destino);
        }
    } else if (valor !== null && valor !== undefined) {
        destino[clave] = [String(valor)];
    }
}

// ------------------------------------------------------------
// Error de la API
// ------------------------------------------------------------
export class ApiError extends Error {
    constructor(status, cuerpo = null) {
        const datos = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? cuerpo : {};
        const generales = Array.isArray(datos.non_field_errors) ? datos.non_field_errors : [];
        const deCampo = {};                              // { dni: ['mensaje'], 'usuario.usuario': [...] }
        for (const [clave, valor] of Object.entries(datos)) {
            if (!CLAVES_NO_CAMPO.includes(clave)) {
                aplanarErrores(clave, valor, deCampo);
            }
        }
        // Si hay un solo campo con error, su mensaje es más útil que el genérico
        // (ej.: un aviso "No se puede pasar de Cancelado a Confirmado.")
        const camposConError = Object.values(deCampo);
        const unicoDeCampo = camposConError.length === 1 ? camposConError[0][0] : null;

        super(datos.detail || generales[0] || unicoDeCampo || MENSAJES_POR_ESTADO[status] || MENSAJES_POR_ESTADO[500]);

        this.name = 'ApiError';
        this.status = status;
        this.codigo = datos.codigo || null;              // ej.: 'turno_superpuesto', 'dni_duplicado'
        this.reintentarEn = datos.reintentar_en ?? null; // segundos, solo en 429
        this.erroresGenerales = generales;
        this.erroresDeCampo = deCampo;
        this.cuerpo = cuerpo;
    }

    get esDeValidacion() {
        return this.status === 400;
    }

    get esDeConexion() {
        return this.status === 0;
    }
}

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
function leerCookie(nombre) {
    const par = document.cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(nombre + '='));
    return par ? decodeURIComponent(par.slice(nombre.length + 1)) : null;
}

// Arma la URL final: '/api' + '/pacientes/' + '?q=perez&estado=1,2'
// Los parámetros vacíos (null, undefined, '') se omiten y los arrays se unen con coma.
function construirUrl(ruta, parametros) {
    const url = CONFIG.API_BASE + ruta;
    if (!parametros) {
        return url;
    }

    const query = new URLSearchParams();
    for (const [clave, valor] of Object.entries(parametros)) {
        if (valor === null || valor === undefined || valor === '') {
            continue;
        }
        query.append(clave, Array.isArray(valor) ? valor.join(',') : String(valor));
    }

    const texto = query.toString();
    return texto ? `${url}?${texto}` : url;
}

async function leerCuerpo(respuesta) {
    if (respuesta.status === 204) {
        return null;
    }
    const tipo = respuesta.headers.get('Content-Type') || '';
    if (!tipo.includes('application/json')) {
        return null;
    }
    try {
        return await respuesta.json();
    } catch {
        return null;
    }
}

function redirigirAlLogin() {
    if (window.location.pathname === CONFIG.LOGIN_URL) {
        return;
    }
    const siguiente = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`${CONFIG.LOGIN_URL}?next=${siguiente}`);
}

// ------------------------------------------------------------
// Request genérica
// opciones:
//   parametros       → objeto para la query string
//   cuerpo           → objeto que se envía como JSON
//   signal           → AbortSignal para cancelar (ej.: búsqueda mientras se escribe)
//   redirigirSi401   → false para no ir al login ante un 401 (ej.: pantalla de login)
// Devuelve el JSON de la respuesta, o null si no tiene cuerpo (204).
// Lanza ApiError si el servidor responde con error o no se pudo conectar.
// ------------------------------------------------------------
export async function request(metodo, ruta, opciones = {}) {
    const { parametros, cuerpo, signal, redirigirSi401 = true } = opciones;
    const metodoMayus = metodo.toUpperCase();

    const headers = { Accept: 'application/json' };
    if (cuerpo !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    if (METODOS_CON_CSRF.includes(metodoMayus)) {
        const token = leerCookie('csrftoken');
        if (token) {
            headers['X-CSRFToken'] = token;
        }
    }

    let respuesta;
    try {
        respuesta = await window.fetch(construirUrl(ruta, parametros), {
            method: metodoMayus,
            headers,
            body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
            credentials: 'same-origin',
            signal: signal || AbortSignal.timeout(CONFIG.TIMEOUT_MS),
        });
    } catch (error) {
        // Cancelación pedida por la pantalla: se propaga tal cual para poder ignorarla
        if (error.name === 'AbortError') {
            throw error;
        }
        if (error.name === 'TimeoutError') {
            throw new ApiError(0, { detail: 'El servidor tardó demasiado en responder. Intentá de nuevo.' });
        }
        throw new ApiError(0);
    }

    const datos = await leerCuerpo(respuesta);

    if (!respuesta.ok) {
        if (respuesta.status === 401 && redirigirSi401) {
            redirigirAlLogin();
        }
        throw new ApiError(respuesta.status, datos);
    }

    return datos;
}

// Atajos por método
export const api = {
    get: (ruta, opciones) => request('GET', ruta, opciones),
    post: (ruta, cuerpo, opciones = {}) => request('POST', ruta, { ...opciones, cuerpo }),
    patch: (ruta, cuerpo, opciones = {}) => request('PATCH', ruta, { ...opciones, cuerpo }),
    put: (ruta, cuerpo, opciones = {}) => request('PUT', ruta, { ...opciones, cuerpo }),
    delete: (ruta, opciones) => request('DELETE', ruta, opciones),
};
