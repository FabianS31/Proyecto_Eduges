// ============================================================
// EduGes - Layout común (base.html)
// Carga el usuario logueado, lo muestra en la barra superior,
// aplica los permisos a los elementos marcados y maneja el cambio de contraseña
// y el cierre de sesión.
//
// Las páginas que necesitan el usuario lo piden con obtenerUsuario():
// la request a /api/auth/me/ se hace una sola vez por página.
// ============================================================

import { ApiError } from './api.js';
import { prepararMostrarPassword } from './componentes/mostrar-password.js';
import { CONFIG } from './config.js';
import { PERMISO } from './constantes.js';
import { auth } from './endpoints.js';
import {
    botonCargando,
    html,
    limpiarErroresFormulario,
    mostrarErroresFormulario,
    nombreCompleto,
    notificar,
    notificarError,
    renderizar,
} from './ui.js';

let promesaUsuario = null;

export function obtenerUsuario() {
    promesaUsuario ??= auth.me();
    return promesaUsuario;
}

export function tienePermiso(usuario, permiso) {
    return usuario.permisos.includes(permiso);
}

// Lo que puede hacer cada usuario se decide por sus permisos y no por el id del rol:
// así funciona igual con el Administrador, el SuperAdministrador o un rol nuevo.
export function esAdministrador(usuario) {
    return tienePermiso(usuario, PERMISO.USUARIOS_ADMIN);
}

// Usuario que atiende pacientes (tiene un profesional asociado en /api/auth/me/)
export function esProfesional(usuario) {
    return Boolean(usuario.profesional);
}

// Los elementos con data-requiere-permiso arrancan ocultos (ver styles.css)
// y se muestran solo si el usuario tiene ese permiso.
function aplicarPermisos(usuario) {
    document.querySelectorAll('[data-requiere-permiso]').forEach((elemento) => {
        if (tienePermiso(usuario, elemento.dataset.requierePermiso)) {
            elemento.classList.add('permiso-concedido');
        } else {
            elemento.remove();
        }
    });
}

function mostrarUsuario(usuario) {
    const contenedor = document.getElementById('usuario-actual');
    if (!contenedor) {
        return;
    }
    const nombre = usuario.profesional ? nombreCompleto(usuario.profesional) : usuario.usuario;
    const detalle = usuario.profesional?.especialidad?.nombre ?? usuario.rol.nombre;
    renderizar(contenedor, html`
        <div class="small fw-semibold">${nombre}</div>
        <div class="text-white-50" style="font-size: 0.75rem;">${detalle}</div>`);
}

async function cerrarSesion(boton) {
    botonCargando(boton, true, 'Saliendo…');
    try {
        await auth.logout();
    } catch (error) {
        // Si la sesión ya había expirado, igual se va al login
        if (error.status !== 401) {
            botonCargando(boton, false);
            notificarError(error);
            return;
        }
    }
    window.location.assign(CONFIG.LOGIN_URL);
}

// ------------------------------------------------------------
// Cambiar contraseña (modal de base.html)
// La API valida la contraseña actual, el mínimo de 8 caracteres y que la nueva
// sea distinta; que las dos nuevas coincidan se valida acá.
// ------------------------------------------------------------
const LARGO_MINIMO_PASSWORD = 8;

function mostrarErroresPassword(formulario, error) {
    const generales = mostrarErroresFormulario(formulario, error);
    renderizar(document.getElementById('form-cambiar-password-errores'), generales.length > 0
        ? html`
            <div class="alert alert-danger py-2 small mb-3 d-flex align-items-center gap-2" role="alert">
                <i class="bi bi-exclamation-circle-fill" aria-hidden="true"></i>
                <span>${generales.join(' ')}</span>
            </div>`
        : '');
    formulario.querySelector('.is-invalid')?.focus();
}

function validarPassword(actual, nueva, confirmacion) {
    const errores = {};
    if (!actual) {
        errores.password_actual = ['Ingresá tu contraseña actual.'];
    }
    if (!nueva) {
        errores.password_nueva = ['Ingresá la contraseña nueva.'];
    } else if (nueva.length < LARGO_MINIMO_PASSWORD) {
        errores.password_nueva = [`La nueva contraseña debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`];
    } else if (nueva === actual) {
        errores.password_nueva = ['La nueva contraseña debe ser diferente de la actual.'];
    }
    if (nueva && confirmacion !== nueva) {
        errores.password_confirmacion = ['Las contraseñas no coinciden.'];
    }
    return errores;
}

async function cambiarPassword(evento) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const boton = document.getElementById('btn-guardar-password');
    const actual = formulario.elements.password_actual.value;
    const nueva = formulario.elements.password_nueva.value;
    const confirmacion = formulario.elements.password_confirmacion.value;

    const errores = validarPassword(actual, nueva, confirmacion);
    if (Object.keys(errores).length > 0) {
        mostrarErroresPassword(formulario, new ApiError(400, errores));
        return;
    }

    limpiarErroresFormulario(formulario);
    renderizar(document.getElementById('form-cambiar-password-errores'), '');
    botonCargando(boton, true);
    try {
        await auth.cambiarPassword(actual, nueva);
        window.bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-cambiar-password')).hide();
        notificar('Tu contraseña se cambió correctamente.');
    } catch (error) {
        mostrarErroresPassword(formulario, error);
    } finally {
        botonCargando(boton, false);
    }
}

function prepararCambioPassword() {
    const modal = document.getElementById('modal-cambiar-password');
    const formulario = document.getElementById('form-cambiar-password');
    if (!modal || !formulario) {
        return;
    }
    prepararMostrarPassword(formulario);
    formulario.addEventListener('submit', cambiarPassword);
    formulario.addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
    modal.addEventListener('shown.bs.modal', () => formulario.elements.password_actual.focus());
    // Al cerrar no quedan contraseñas ni errores escritos en el formulario
    modal.addEventListener('hidden.bs.modal', () => {
        formulario.reset();
        limpiarErroresFormulario(formulario);
        renderizar(document.getElementById('form-cambiar-password-errores'), '');
    });
}

async function iniciar() {
    const botonSalir = document.getElementById('btn-cerrar-sesion');
    botonSalir?.addEventListener('click', () => cerrarSesion(botonSalir));
    prepararCambioPassword();

    try {
        const usuario = await obtenerUsuario();
        mostrarUsuario(usuario);
        aplicarPermisos(usuario);
    } catch (error) {
        // Un 401 ya redirigió al login desde api.js
        if (error.status !== 401) {
            const contenedor = document.getElementById('usuario-actual');
            if (contenedor) {
                renderizar(contenedor, html`<div class="small text-white-50">Sin conexión</div>`);
            }
            notificarError(error);
        }
    }
}

iniciar();
