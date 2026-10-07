// ============================================================
// EduGes - Login (templates/login.html)
// Endpoints: /api/auth/csrf/, /api/auth/login/ y /api/auth/me/.
//
// - Si ya hay sesión, va directo al destino.
// - Después de entrar vuelve a la página de ?next= (solo rutas internas).
// - 429: bloquea el botón con una cuenta regresiva (la API bloquea 60 s después de 5 fallos).
// ============================================================

import { ApiError } from '../api.js';
import { CONFIG } from '../config.js';
import { prepararMostrarPassword } from '../componentes/mostrar-password.js';
import { auth } from '../endpoints.js';
import {
    botonCargando,
    html,
    limpiarErroresFormulario,
    mostrarErroresFormulario,
    renderizar,
} from '../ui.js';

const DESTINO_POR_DEFECTO = '/dashboard/';

const $ = (id) => document.getElementById(id);

// Solo se aceptan rutas internas en ?next=. Evita "redirecciones abiertas": un link como
// /login/?next=https://sitio-falso.com no puede llevar al usuario afuera después de entrar.
function destinoSeguro(next) {
    if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
        return DESTINO_POR_DEFECTO;
    }
    try {
        const url = new URL(next, window.location.origin);
        if (url.origin !== window.location.origin || url.pathname === CONFIG.LOGIN_URL) {
            return DESTINO_POR_DEFECTO;
        }
        return url.pathname + url.search + url.hash;
    } catch {
        return DESTINO_POR_DEFECTO;
    }
}

function irAlDestino() {
    const next = new URLSearchParams(window.location.search).get('next');
    // replace: el login no queda en el historial (el botón "atrás" no vuelve acá)
    window.location.replace(destinoSeguro(next));
}

function mostrarAlerta(contenido, tipo = 'danger') {
    renderizar($('login-errores'), contenido
        ? html`
            <div class="alert alert-${tipo} py-2 small mb-3 d-flex align-items-center gap-2" role="alert">
                <i class="bi bi-exclamation-circle-fill" aria-hidden="true"></i>
                <span>${contenido}</span>
            </div>`
        : '');
}

// ------------------------------------------------------------
// Bloqueo por demasiados intentos (429)
// El aviso se anuncia una sola vez; la cuenta regresiva se actualiza
// sin anunciarse cada segundo (aria-live="off").
// ------------------------------------------------------------
let temporizadorBloqueo = null;

function bloquearPor(segundos) {
    const boton = $('btn-ingresar');
    clearInterval(temporizadorBloqueo);
    let restante = Math.max(1, Math.ceil(segundos));

    boton.disabled = true;
    mostrarAlerta(html`Demasiados intentos fallidos. Probá de nuevo en
        <span id="login-cuenta" aria-live="off">${restante}</span> s.`, 'warning');

    temporizadorBloqueo = setInterval(() => {
        restante -= 1;
        if (restante <= 0) {
            clearInterval(temporizadorBloqueo);
            boton.disabled = false;
            mostrarAlerta('');
            return;
        }
        const cuenta = $('login-cuenta');
        if (cuenta) {
            cuenta.textContent = restante;
        }
    }, 1000);
}

// ------------------------------------------------------------
// Envío
// ------------------------------------------------------------
async function ingresar(evento) {
    evento.preventDefault();
    const formulario = $('form-login');
    const boton = $('btn-ingresar');
    if (boton.disabled) {
        return;
    }

    const usuario = formulario.elements.usuario.value.trim();
    const password = formulario.elements.password.value;
    const recordar = formulario.elements.recordar.checked;
    mostrarAlerta('');

    const errores = {};
    if (!usuario) {
        errores.usuario = ['Ingresá tu usuario.'];
    }
    if (!password) {
        errores.password = ['Ingresá tu contraseña.'];
    }
    if (Object.keys(errores).length > 0) {
        mostrarErroresFormulario(formulario, new ApiError(400, errores));
        formulario.querySelector('.is-invalid')?.focus();
        return;
    }

    limpiarErroresFormulario(formulario);
    botonCargando(boton, true, 'Ingresando…');

    try {
        await auth.csrf();
        await auth.login(usuario, password, recordar);
        irAlDestino(); // el botón queda en "Ingresando…" hasta que cambia la página
    } catch (error) {
        botonCargando(boton, false);
        if (error.status === 429) {
            bloquearPor(error.reintentarEn ?? 60);
            return;
        }
        const generales = mostrarErroresFormulario(formulario, error);
        if (generales.length > 0) {
            mostrarAlerta(generales.join(' '));
        }
        // Se borra la contraseña y se deja el cursor ahí para reintentar
        formulario.elements.password.value = '';
        (formulario.querySelector('.is-invalid') ?? formulario.elements.password).focus();
    }
}

// ------------------------------------------------------------
// Inicio
// ------------------------------------------------------------
async function iniciar() {
    const formulario = $('form-login');
    prepararMostrarPassword(formulario);
    formulario.addEventListener('submit', ingresar);
    formulario.addEventListener('input', (e) => e.target.classList.remove('is-invalid'));

    // Se llegó acá desde otra página (sesión no iniciada o vencida): se explica por qué
    if (new URLSearchParams(window.location.search).has('next')) {
        mostrarAlerta('Tu sesión no está iniciada o expiró. Ingresá para continuar.', 'info');
    }

    // Si ya hay sesión, no tiene sentido mostrar el login
    try {
        await auth.me({ redirigirSi401: false });
        irAlDestino();
    } catch {
        // Sin sesión (o sin conexión): se queda en el formulario
    }
}

iniciar();
