// ============================================================
// EduGes - Layout común (base.html)
// Carga el usuario logueado, lo muestra en la barra superior,
// aplica los permisos a los elementos marcados y maneja el cambio de contraseña,
// el cierre de sesión y el aviso de cierre por inactividad (sesion.js).
//
// Las páginas que necesitan el usuario lo piden con obtenerUsuario():
// la request a /api/auth/me/ se hace una sola vez por página.
// ============================================================

import { ApiError } from './api.js';
import { inicializarModalObrasSociales } from './componentes/obras-sociales-modal.js';
import { prepararMostrarPassword } from './componentes/mostrar-password.js';
import { CONFIG } from './config.js';
import { PERMISO } from './constantes.js';
import { auth, profesionales } from './endpoints.js';
import { iniciarControlDeSesion } from './sesion.js';
import {
    botonCargando,
    html,
    iniciales,
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
    if (!usuario) return false;
    return Boolean(
        usuario.is_superuser ||
        usuario.rol?.rol === 'SuperAdministrador' ||
        usuario.rol?.nombre === 'SuperAdministrador' ||
        usuario.rol?.rol === 'Administrador' ||
        usuario.rol?.nombre === 'Administrador' ||
        tienePermiso(usuario, PERMISO.USUARIOS_ADMIN)
    );
}

// Comprueba si el usuario tiene un perfil profesional asociado en el centro
export function tienePerfilProfesional(usuario) {
    return Boolean(usuario?.profesional);
}

// Usuario que atiende pacientes (rol Profesional). Si opera como Administrador institucional, no se considera profesional clínico
export function esProfesional(usuario) {
    if (!usuario) return false;
    if (esAdministrador(usuario)) {
        return false;
    }
    return Boolean(
        usuario.profesional ||
        usuario.rol?.nombre === 'Profesional' ||
        usuario.rol?.rol === 'Profesional'
    );
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
    const avatar = document.getElementById('usuario-avatar');
    const dropName = document.getElementById('dropdown-user-name');
    const dropRole = document.getElementById('dropdown-user-role');

    const nombre = usuario.profesional ? nombreCompleto(usuario.profesional) : usuario.usuario;
    const detalle = usuario.profesional?.especialidad?.nombre ?? usuario.rol.nombre;
    const letras = usuario.profesional ? iniciales(usuario.profesional) : usuario.usuario.slice(0, 2).toUpperCase();

    if (contenedor) {
        renderizar(contenedor, html`
            <div><span class="eg-user__name">${nombre}</span><span class="eg-user__role">${detalle}</span></div>`);
    }
    if (avatar) {
        avatar.textContent = letras;
    }
    if (dropName) {
        dropName.textContent = nombre;
    }
    if (dropRole) {
        dropRole.textContent = detalle;
    }
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
                <span class="ms" aria-hidden="true">error</span>
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
    } else if (/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u.test(nueva)) {
        errores.password_nueva = ['La contraseña no puede comenzar ni terminar con espacios en blanco.'];
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

// ------------------------------------------------------------
// Un modal encima de otro (ej.: "Agendar turno" o "¿Cancelar el turno?" desde la ficha del paciente).
// Bootstrap no lo resuelve solo: cada modal nuevo y su fondo oscuro van por encima del anterior,
// y al cerrar el de arriba, el de abajo vuelve a retener el foco del teclado y la página
// sigue sin desplazarse por detrás.
// ------------------------------------------------------------
const Z_MODAL = 1055;

function prepararModalesApilados() {
    document.addEventListener('show.bs.modal', (evento) => {
        const abiertos = document.querySelectorAll('.modal.show').length;
        const z = Z_MODAL + abiertos * 20;
        evento.target.style.zIndex = z;
        if (abiertos > 0) {
            // El fondo oscuro de este modal se agrega justo después de este evento
            setTimeout(() => {
                const fondos = document.querySelectorAll('.modal-backdrop');
                const fondo = fondos[fondos.length - 1];
                if (fondo) {
                    fondo.style.zIndex = z - 5;
                }
            });
        }
    });
    document.addEventListener('hidden.bs.modal', () => {
        const abiertos = [...document.querySelectorAll('.modal.show')];
        if (abiertos.length === 0) {
            return;
        }
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
        const deArriba = abiertos.reduce((a, b) => (Number(b.style.zIndex || Z_MODAL) > Number(a.style.zIndex || Z_MODAL) ? b : a));
        // El modal que se cerró ya devolvió el foco al botón que lo abrió (dentro del de abajo).
        // Al reactivar la "trampa de foco" de Bootstrap 5.3 (_focustrap: mantiene el Tab dentro
        // del modal), Bootstrap mueve el foco al modal entero: se lo devolvemos a ese botón.
        // (el modal que se cerró se la había desactivado sin avisarle: por eso se reinicia)
        const foco = document.activeElement;
        const trampa = window.bootstrap.Modal.getInstance(deArriba)?._focustrap;
        trampa?.deactivate();
        trampa?.activate();
        if (foco && foco !== document.body && deArriba.contains(foco)) {
            foco.focus();
        }
    });
}

function prepararMenuMovil() {
    const btnToggle = document.getElementById('btn-toggle-menu');
    const collapse = document.getElementById('eg-nav-collapse');
    const icono = document.getElementById('icono-menu-toggle');
    if (!btnToggle || !collapse) {
        return;
    }

    btnToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const abierto = collapse.classList.toggle('is-open');
        btnToggle.setAttribute('aria-expanded', String(abierto));
        if (icono) {
            icono.textContent = abierto ? 'close' : 'menu';
        }
    });

    // Cerrar al hacer clic en un enlace del menú (solo enlaces directos, no desplegables)
    collapse.querySelectorAll('a.eg-nav__item').forEach((link) => {
        link.addEventListener('click', () => {
            collapse.classList.remove('is-open');
            btnToggle.setAttribute('aria-expanded', 'false');
            if (icono) icono.textContent = 'menu';
        });
    });

    // Cerrar si se hace clic fuera del menú desplegado
    document.addEventListener('click', (evento) => {
        if (!collapse.contains(evento.target) && !btnToggle.contains(evento.target)) {
            if (collapse.classList.contains('is-open')) {
                collapse.classList.remove('is-open');
                btnToggle.setAttribute('aria-expanded', 'false');
                if (icono) icono.textContent = 'menu';
            }
        }
    });
}

function prepararModalEspecialidad() {
    const modalEl = document.getElementById('modal-especialidad');
    const form = document.getElementById('form-nueva-especialidad');
    if (!modalEl || !form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (document.getElementById('btn-guardar-especialidad')?.disabled) return;
        const input = document.getElementById('especialidad-nombre');
        const nombre = input?.value?.trim() ?? '';
        const contErrores = document.getElementById('form-especialidad-errores');
        const btn = document.getElementById('btn-guardar-especialidad');

        if (!nombre) {
            if (contErrores) {
                renderizar(contErrores, html`
                    <div class="alert alert-danger py-2 small mb-3 d-flex align-items-center gap-2" role="alert">
                        <span class="ms" aria-hidden="true">error</span>
                        <span>Ingresá el nombre de la especialidad.</span>
                    </div>`);
            }
            input?.focus();
            return;
        }

        botonCargando(btn, true);
        try {
            await profesionales.crearEspecialidad({ nombre });
            window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            form.reset();
            if (contErrores) renderizar(contErrores, '');
            notificar(`Especialidad "${nombre}" creada exitosamente.`);
        } catch (err) {
            notificarError(err);
        } finally {
            botonCargando(btn, false);
        }
    });

    modalEl.addEventListener('hidden.bs.modal', () => {
        form.reset();
        const contErrores = document.getElementById('form-especialidad-errores');
        if (contErrores) renderizar(contErrores, '');
    });
}

function prepararModalNuevoUsuario() {
    const modalEl = document.getElementById('modal-nuevo-usuario');
    const form = document.getElementById('form-nuevo-usuario');
    if (!modalEl || !form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (document.getElementById('btn-guardar-nuevo-usuario')?.disabled) return;
        const inputUsuario = document.getElementById('nuevo-usuario-nombre');
        const inputPass = document.getElementById('nuevo-usuario-password');
        const inputConf = document.getElementById('nuevo-usuario-password-confirm');
        const contErrores = document.getElementById('form-nuevo-usuario-errores');
        const btn = document.getElementById('btn-guardar-nuevo-usuario');

        const usuario = inputUsuario?.value?.trim() ?? '';
        const password = inputPass?.value ?? '';
        const confirmacion = inputConf?.value ?? '';

        const errores = [];
        if (!usuario) errores.push('Ingresá el nombre de usuario.');
        else if ([...usuario].length > 100) errores.push('El usuario admite hasta 100 caracteres.');
        else if (/\s/.test(usuario)) errores.push('El usuario no puede contener espacios.');
        if (!password) errores.push('Ingresá la contraseña.');
        else if (password.length < 8) errores.push('La contraseña debe tener al menos 8 caracteres.');
        else if (password.length > 128) errores.push('La contraseña no puede superar los 128 caracteres.');
        else if (/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u.test(password)) errores.push('La contraseña no puede comenzar ni terminar con espacios en blanco.');
        if (password && password !== confirmacion) errores.push('Las contraseñas no coinciden.');

        if (errores.length > 0) {
            if (contErrores) {
                renderizar(contErrores, html`
                    <div class="alert alert-danger py-2 small mb-3 d-flex align-items-center gap-2" role="alert">
                        <span class="ms" aria-hidden="true">error</span>
                        <span>${errores.join(' ')}</span>
                    </div>`);
            }
            return;
        }

        botonCargando(btn, true);
        try {
            await auth.crearAdministrador({ usuario, password });
            window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            form.reset();
            if (contErrores) renderizar(contErrores, '');
            notificar(`Administrador "${usuario}" creado exitosamente.`);
        } catch (err) {
            notificarError(err);
        } finally {
            botonCargando(btn, false);
        }
    });

    modalEl.addEventListener('hidden.bs.modal', () => {
        form.reset();
        const contErrores = document.getElementById('form-nuevo-usuario-errores');
        if (contErrores) renderizar(contErrores, '');
    });
}

function inicializarDesplegablesNav() {
    const adminToggle = document.getElementById('dropdownAdminMenu');
    if (adminToggle && window.bootstrap?.Dropdown) {
        window.bootstrap.Dropdown.getOrCreateInstance(adminToggle);
    }
    const userToggle = document.getElementById('dropdownUsuario');
    if (userToggle && window.bootstrap?.Dropdown) {
        window.bootstrap.Dropdown.getOrCreateInstance(userToggle);
    }
}

// ------------------------------------------------------------
// DNI: validar sin borrar ni convertir caracteres ingresados.
// El pegado se intercepta antes de que maxlength pueda truncar el texto.
// ------------------------------------------------------------
function prepararInputsDni() {
    const estados = new WeakMap();
    const mensaje = 'El DNI debe contener 7 u 8 dígitos del 0 al 9, sin puntos, guiones, letras ni espacios.';
    const esCampoDni = el => el instanceof HTMLInputElement
        && (el.name === 'dni' || el.name === 'tutor_dni');
    const validar = campo => {
        const estado = estados.get(campo);
        if (estado?.rechazo) { campo.setCustomValidity(estado.rechazo); return false; }
        const intacto = estado && estado.original === campo.value;
        const valido = intacto || /^[0-9]{7,8}$/.test(campo.value);
        campo.setCustomValidity(valido ? '' : mensaje);
        if (estado) estado.ultimo = campo.value;
        return valido;
    };
    document.addEventListener('focusin', evento => {
        const campo = evento.target;
        if (!esCampoDni(campo)) return;
        const previo = estados.get(campo);
        if (!previo || previo.ultimo !== campo.value) {
            estados.set(campo, {original: campo.value, ultimo: campo.value, modificado: false});
            campo.setCustomValidity('');
        }
    });
    const insertarCompleto = (evento, texto) => {
        const campo = evento.target;
        evento.preventDefault();
        // Un input de una linea elimina saltos automaticamente: no insertarlos.
        if (/[\r\n]/.test(texto)) {
            const estado = estados.get(campo) ?? {original: null};
            estado.rechazo = mensaje;
            estado.modificado = true;
            estado.ultimo = campo.value;
            estados.set(campo, estado);
            validar(campo);
            campo.reportValidity();
            return;
        }
        campo.setRangeText(texto, campo.selectionStart ?? campo.value.length,
            campo.selectionEnd ?? campo.value.length, 'end');
        campo.dispatchEvent(new Event('input', {bubbles: true}));
        if (!validar(campo)) campo.reportValidity();
    };
    document.addEventListener('paste', evento => {
        if (!esCampoDni(evento.target)) return;
        if (!evento.clipboardData) {
            evento.preventDefault();
            const campo = evento.target;
            const estado = estados.get(campo) ?? {original: null};
            estado.rechazo = 'No se pudo leer el pegado. Ingresá el DNI manualmente.';
            estado.modificado = true;
            estado.ultimo = campo.value;
            estados.set(campo, estado);
            validar(campo);
            evento.target.reportValidity();
            return;
        }
        insertarCompleto(evento, evento.clipboardData.getData('text/plain'));
    });
    document.addEventListener('beforeinput', evento => {
        const campo = evento.target;
        if (!esCampoDni(campo) || evento.isComposing || !evento.cancelable) return;
        const texto = evento.data ?? evento.dataTransfer?.getData('text/plain');
        if (!evento.inputType?.startsWith('insert') || texto == null) return;
        const longitud = campo.value.length - ((campo.selectionEnd ?? 0) - (campo.selectionStart ?? 0)) + texto.length;
        if (/[\r\n]/.test(texto) || (campo.maxLength >= 0 && longitud > campo.maxLength)) insertarCompleto(evento, texto);
    });
    document.addEventListener('drop', evento => {
        if (esCampoDni(evento.target) && evento.dataTransfer) {
            insertarCompleto(evento, evento.dataTransfer.getData('text/plain'));
        }
    });
    document.addEventListener('input', evento => {
        const campo = evento.target;
        if (!esCampoDni(campo)) return;
        if (!estados.has(campo)) estados.set(campo, {original: null});
        estados.get(campo).modificado = true;
        estados.get(campo).rechazo = null;
        validar(campo);
    });
    document.addEventListener('focusout', evento => {
        if (esCampoDni(evento.target) && estados.get(evento.target)?.modificado
            && !validar(evento.target)) evento.target.reportValidity();
    });
    document.addEventListener('submit', evento => {
        for (const campo of evento.target.elements ?? []) {
            if (esCampoDni(campo) && estados.get(campo)?.modificado && !validar(campo)) {
                evento.preventDefault();
                evento.stopImmediatePropagation();
                campo.reportValidity();
                return;
            }
        }
    }, true);
    document.addEventListener('reset', evento => {
        for (const campo of evento.target.elements ?? []) {
            if (esCampoDni(campo)) { estados.delete(campo); campo.setCustomValidity(''); }
        }
    }, true);
    document.addEventListener('show.bs.modal', evento => {
        for (const campo of evento.target.querySelectorAll?.('input') ?? []) {
            if (esCampoDni(campo)) { estados.delete(campo); campo.setCustomValidity(''); }
        }
    }, true);
}

async function iniciar() {
    prepararModalesApilados();
    prepararMenuMovil();
    inicializarDesplegablesNav();
    prepararInputsDni();
    const botonSalir = document.getElementById('btn-cerrar-sesion');
    botonSalir?.addEventListener('click', () => cerrarSesion(botonSalir));
    prepararCambioPassword();
    inicializarModalObrasSociales();
    prepararModalEspecialidad();
    prepararModalNuevoUsuario();

    try {
        const usuario = await obtenerUsuario();
        mostrarUsuario(usuario);
        aplicarPermisos(usuario);
        iniciarControlDeSesion({ salir: () => cerrarSesion(botonSalir) });
    } catch (error) {
        // Un 401 ya redirigió al login desde api.js
        if (error.status !== 401) {
            const contenedor = document.getElementById('usuario-actual');
            if (contenedor) {
                renderizar(contenedor, html`<span class="eg-user__role">Sin conexión</span>`);
            }
            notificarError(error);
        }
    }
}

iniciar();
