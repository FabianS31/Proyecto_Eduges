// ============================================================
// EduGes - Layout común (base.html)
// Carga el usuario logueado, lo muestra en la barra superior,
// aplica los permisos a los elementos marcados y maneja el cierre de sesión.
//
// Las páginas que necesitan el usuario lo piden con obtenerUsuario():
// la request a /api/auth/me/ se hace una sola vez por página.
// ============================================================

import { CONFIG } from './config.js';
import { auth } from './endpoints.js';
import { botonCargando, html, nombreCompleto, notificarError, renderizar } from './ui.js';

let promesaUsuario = null;

export function obtenerUsuario() {
    promesaUsuario ??= auth.me();
    return promesaUsuario;
}

export function tienePermiso(usuario, permiso) {
    return usuario.permisos.includes(permiso);
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

async function iniciar() {
    const botonSalir = document.getElementById('btn-cerrar-sesion');
    botonSalir?.addEventListener('click', () => cerrarSesion(botonSalir));

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
