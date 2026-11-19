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
import { errorDomicilio, mostrarErroresDelFormulario, validarCamposPreventivos } from './componentes/formularios.js';
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

function mostrarErrorEnModal(form, contErrores, err) {
    if (contErrores && typeof mostrarErroresDelFormulario === 'function') {
        mostrarErroresDelFormulario(form, contErrores, err);
        return;
    }
    if (contErrores) {
        const mensaje = err?.message || 'No se pudo completar la operación. Intentá nuevamente.';
        renderizar(contErrores, html`
            <div class="alert alert-danger py-2 small mb-3 d-flex align-items-center gap-2" role="alert">
                <span class="ms" aria-hidden="true">error</span>
                <span>${mensaje}</span>
            </div>`);
        return;
    }
    notificarError(err);
}

function prepararModalEspecialidad() {
    const modalEl = document.getElementById('modal-especialidad');
    const form = document.getElementById('form-nueva-especialidad');
    if (!modalEl || !form) return;

    form.addEventListener('input', (e) => e.target?.classList?.remove('is-invalid'));

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (document.getElementById('btn-guardar-especialidad')?.disabled) return;
        const input = document.getElementById('especialidad-nombre');
        const nombre = input?.value?.trim() ?? '';
        const contErrores = document.getElementById('form-especialidad-errores');
        const btn = document.getElementById('btn-guardar-especialidad');

        if (typeof limpiarErroresFormulario === 'function') limpiarErroresFormulario(form);
        if (contErrores) renderizar(contErrores, '');

        let errorNombre = null;
        if (!nombre) errorNombre = 'Ingresá el nombre de la especialidad.';
        else if ([...nombre].length > 100) errorNombre = 'La especialidad admite hasta 100 caracteres.';

        if (errorNombre) {
            if (contErrores) {
                renderizar(contErrores, html`
                    <div class="alert alert-danger py-2 small mb-3 d-flex align-items-center gap-2" role="alert">
                        <span class="ms" aria-hidden="true">error</span>
                        <span>${errorNombre}</span>
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
            if (typeof limpiarErroresFormulario === 'function') limpiarErroresFormulario(form);
            if (contErrores) renderizar(contErrores, '');
            notificar(`Especialidad "${nombre}" creada exitosamente.`);
        } catch (err) {
            mostrarErrorEnModal(form, contErrores, err);
        } finally {
            botonCargando(btn, false);
        }
    });

    modalEl.addEventListener('hidden.bs.modal', () => {
        form.reset();
        if (typeof limpiarErroresFormulario === 'function') limpiarErroresFormulario(form);
        const contErrores = document.getElementById('form-especialidad-errores');
        if (contErrores) renderizar(contErrores, '');
    });
}

function prepararModalNuevoUsuario() {
    const modalEl = document.getElementById('modal-nuevo-usuario');
    const form = document.getElementById('form-nuevo-usuario');
    if (!modalEl || !form) return;

    form.addEventListener('input', (e) => e.target?.classList?.remove('is-invalid'));

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (document.getElementById('btn-guardar-nuevo-usuario')?.disabled) return;
        const inputUsuario = document.getElementById('nuevo-usuario-nombre');
        const inputPass = document.getElementById('nuevo-usuario-password');
        const inputConf = document.getElementById('nuevo-usuario-password-confirm');
        const contErrores = document.getElementById('form-nuevo-usuario-errores');
        const btn = document.getElementById('btn-guardar-nuevo-usuario');

        if (typeof limpiarErroresFormulario === 'function') limpiarErroresFormulario(form);
        if (contErrores) renderizar(contErrores, '');

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
            if (typeof limpiarErroresFormulario === 'function') limpiarErroresFormulario(form);
            if (contErrores) renderizar(contErrores, '');
            notificar(`Administrador "${usuario}" creado exitosamente.`);
        } catch (err) {
            mostrarErrorEnModal(form, contErrores, err);
        } finally {
            botonCargando(btn, false);
        }
    });

    modalEl.addEventListener('hidden.bs.modal', () => {
        form.reset();
        if (typeof limpiarErroresFormulario === 'function') limpiarErroresFormulario(form);
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
// DNI: bloquear letras/símbolos y >8 dígitos al tipear, conservando
// la protección H19 ante pegados/autocompletados e intactos históricos.
// ------------------------------------------------------------
function prepararInputsDni() {
    const MAX_DNI_DIGITOS = 8;
    const estados = new WeakMap();
    const mensaje = 'El DNI debe contener 7 u 8 dígitos del 0 al 9, sin puntos, guiones, letras ni espacios.';
    const mensajeSoloDigitos = 'Solo se permiten números del 0 al 9.';
    const mensajeMaximo = 'El DNI admite hasta 8 dígitos.';
    const mensajePegado = 'Pegado rechazado: el DNI solo admite dígitos del 0 al 9 (máximo 8), sin puntos, guiones ni espacios.';
    const mensajePegadoLargo = 'Pegado rechazado: el DNI admite hasta 8 dígitos (no se recortó automáticamente).';
    const esCampoDni = el => el instanceof HTMLInputElement
        && (el.name === 'dni' || el.name === 'tutor_dni');

    const obtenerEstado = campo => {
        let estado = estados.get(campo);
        if (!estado) {
            estado = { original: campo.value, ultimo: campo.value, modificado: false, rechazo: null };
            estados.set(campo, estado);
        }
        return estado;
    };

    const validar = (campo, { mostrarError = false } = {}) => {
        const estado = estados.get(campo);
        if (estado?.rechazo) {
            campo.setCustomValidity(estado.rechazo);
            if (mostrarError) mostrarAvisoPreventivo(campo, estado.rechazo, { invalido: true });
            return false;
        }
        const intacto = estado && estado.original === campo.value;
        const valido = intacto || /^[0-9]{7,8}$/.test(campo.value);
        campo.setCustomValidity(valido ? '' : mensaje);
        if (estado) estado.ultimo = campo.value;
        if (valido) {
            limpiarAvisoPreventivo(campo, { quitarInvalido: true });
        } else if (mostrarError) {
            mostrarAvisoPreventivo(campo, mensaje, { invalido: true });
        }
        return valido;
    };

    const sincronizarCampo = (campo) => {
        if (!esCampoDni(campo)) return;
        estados.set(campo, { original: campo.value, ultimo: campo.value, modificado: false, rechazo: null });
        campo.setCustomValidity('');
        limpiarAvisoPreventivo(campo, { quitarInvalido: true });
    };

    const procesarPegado = (evento, campo, texto) => {
        if (typeof evento.preventDefault === 'function') {
            evento.preventDefault();
        }
        const estado = obtenerEstado(campo);
        const candidato = valorCandidatoCampo(campo, texto);
        let errorPegado = null;
        if (/[\r\n]/.test(texto) || /[^0-9]/.test(texto)) {
            errorPegado = mensajePegado;
        } else if (candidato.length > MAX_DNI_DIGITOS) {
            errorPegado = mensajePegadoLargo;
        }

        if (errorPegado) {
            estado.rechazo = errorPegado;
            estado.modificado = true;
            estado.ultimo = campo.value;
            validar(campo, { mostrarError: true });
            return;
        }

        estado.rechazo = null;
        campo.setRangeText(texto, campo.selectionStart ?? campo.value.length,
            campo.selectionEnd ?? campo.value.length, 'end');
        campo.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const manejarEntradaActualizada = (campo) => {
        const estado = estados.get(campo) ?? { original: null, ultimo: '', modificado: false, rechazo: null };
        estado.modificado = campo.value !== estado.original;
        estado.rechazo = null;
        estado.ultimo = campo.value;
        estados.set(campo, estado);

        if (campo.value === estado.original || /^[0-9]{7,8}$/.test(campo.value)) {
            validar(campo);
            return;
        }
        // Si autocompletado o composición no cancelable insertó caracteres inválidos o >8 dígitos,
        // no se recortan ni limpian en silencio: queda visible e inválido.
        if (/[^0-9]/.test(campo.value) || campo.value.length > MAX_DNI_DIGITOS) {
            validar(campo, { mostrarError: true });
            return;
        }
        // 0..6 dígitos mientras el usuario sigue escribiendo: no flashear error prematuro.
        campo.setCustomValidity(campo.value ? mensaje : '');
        limpiarAvisoPreventivo(campo, { quitarInvalido: true });
    };

    document.addEventListener('focusin', evento => {
        const campo = evento.target;
        if (!esCampoDni(campo)) return;
        const previo = estados.get(campo);
        if (!previo || previo.ultimo !== campo.value) {
            sincronizarCampo(campo);
        }
    });

    document.addEventListener('paste', evento => {
        if (!esCampoDni(evento.target)) return;
        if (!evento.clipboardData) {
            evento.preventDefault();
            const campo = evento.target;
            const estado = obtenerEstado(campo);
            estado.rechazo = 'No se pudo leer el pegado. Ingresá el DNI manualmente.';
            estado.modificado = true;
            estado.ultimo = campo.value;
            validar(campo, { mostrarError: true });
            return;
        }
        procesarPegado(evento, evento.target, evento.clipboardData.getData('text/plain'));
    });

    document.addEventListener('drop', evento => {
        if (esCampoDni(evento.target) && evento.dataTransfer) {
            procesarPegado(evento, evento.target, evento.dataTransfer.getData('text/plain'));
        }
    });

    document.addEventListener('beforeinput', evento => {
        const campo = evento.target;
        if (!esCampoDni(campo) || evento.isComposing || !evento.cancelable) return;
        const tipo = evento.inputType ?? '';
        if (!tipo.startsWith('insert')) return;
        const texto = evento.data ?? evento.dataTransfer?.getData('text/plain');
        if (texto == null) return;

        if (tipo === 'insertFromPaste' || tipo === 'insertFromDrop') {
            procesarPegado(evento, campo, texto);
            return;
        }

        const estado = obtenerEstado(campo);
        const candidato = valorCandidatoCampo(campo, texto);
        if (/[\r\n]/.test(texto) || /[^0-9]/.test(texto)) {
            evento.preventDefault();
            if (campo.value === estado.original && /[^0-9]/.test(campo.value)) {
                mostrarAvisoPreventivo(campo, 'Para modificar el DNI histórico, seleccionalo e ingresá 7 u 8 dígitos.');
            } else {
                mostrarAvisoPreventivo(campo, mensajeSoloDigitos);
            }
            return;
        }
        if (candidato.length > MAX_DNI_DIGITOS) {
            evento.preventDefault();
            if (campo.value === estado.original && /[^0-9]/.test(campo.value)) {
                mostrarAvisoPreventivo(campo, 'Para modificar el DNI histórico, seleccionalo e ingresá 7 u 8 dígitos.');
            } else {
                mostrarAvisoPreventivo(campo, mensajeMaximo);
            }
        }
    });

    document.addEventListener('input', evento => {
        const campo = evento.target;
        if (!esCampoDni(campo) || evento.isComposing) return;
        manejarEntradaActualizada(campo);
    });

    document.addEventListener('compositionend', evento => {
        const campo = evento.target;
        if (!esCampoDni(campo)) return;
        manejarEntradaActualizada(campo);
    });

    document.addEventListener('focusout', evento => {
        const campo = evento.target;
        if (!esCampoDni(campo)) return;
        const estado = estados.get(campo);
        if (estado?.rechazo) {
            validar(campo, { mostrarError: true });
            return;
        }
        if (estado?.modificado && campo.value !== '' && !/^[0-9]{7,8}$/.test(campo.value)) {
            validar(campo, { mostrarError: true });
            return;
        }
        validar(campo);
    });

    document.addEventListener('submit', evento => {
        for (const campo of evento.target?.elements ?? []) {
            const estado = esCampoDni(campo) ? estados.get(campo) : null;
            if (estado && (estado.rechazo || (estado.modificado && !validar(campo, { mostrarError: true })))) {
                evento.preventDefault();
                evento.stopImmediatePropagation();
                validar(campo, { mostrarError: true });
                campo.focus?.();
                return;
            }
        }
    }, true);

    const reiniciarContenedor = (raiz) => {
        for (const campo of raiz?.elements ?? raiz?.querySelectorAll?.('input') ?? []) {
            sincronizarCampo(campo);
        }
    };
    document.addEventListener('reset', evento => reiniciarContenedor(evento.target), true);
    document.addEventListener('show.bs.modal', evento => {
        reiniciarContenedor(evento.target);
        queueMicrotask(() => reiniciarContenedor(evento.target));
    }, true);
    document.addEventListener('hidden.bs.modal', evento => reiniciarContenedor(evento.target), true);
    document.addEventListener('eduges:sincronizar-campos', evento => reiniciarContenedor(evento.target), true);
}

// ------------------------------------------------------------
// Utilidades compartidas de validación preventiva en vivo (DNI / Nombre / Apellido)
// ------------------------------------------------------------
const piesPreventivos = new WeakMap();

function obtenerPiePreventivo(campo, { conContador = false } = {}) {
    let pie = piesPreventivos.get(campo);
    if (pie) return pie;
    if (typeof document?.createElement !== 'function') return null;

    const contenedor = document.createElement('div');
    contenedor.className = 'form-text d-flex justify-content-between align-items-start gap-2 mt-1';
    contenedor.dataset.piePreventivo = '';
    contenedor.hidden = !conContador;

    const aviso = document.createElement('span');
    aviso.className = 'text-danger fw-semibold';
    aviso.dataset.avisoPreventivo = '';
    aviso.setAttribute('role', 'status');
    aviso.setAttribute('aria-live', 'polite');
    aviso.hidden = true;
    contenedor.appendChild(aviso);

    let contador = null;
    if (conContador) {
        contador = document.createElement('span');
        contador.className = 'ms-auto flex-shrink-0 text-muted';
        contador.dataset.contadorCampo = '';
        contenedor.appendChild(contador);
    }

    const ancla = typeof campo.closest === 'function'
        ? (campo.closest('.combobox, .input-group') ?? campo)
        : campo;
    if (typeof ancla?.insertAdjacentElement === 'function') {
        ancla.insertAdjacentElement('afterend', contenedor);
    }
    pie = { contenedor, aviso, contador, conContador };
    piesPreventivos.set(campo, pie);
    return pie;
}

function mostrarAvisoPreventivo(campo, mensaje, { invalido = false, conContador = false } = {}) {
    if (invalido) {
        campo.classList?.add('is-invalid');
    } else {
        campo.classList?.remove('is-invalid');
    }
    const pie = obtenerPiePreventivo(campo, { conContador });
    if (!pie) return;
    pie.aviso.textContent = mensaje || '';
    pie.aviso.hidden = !mensaje;
    pie.contenedor.hidden = !conContador && !mensaje;
}

function limpiarAvisoPreventivo(campo, { quitarInvalido = true, conContador = false } = {}) {
    if (quitarInvalido) {
        campo.classList?.remove('is-invalid');
    }
    const pie = piesPreventivos.get(campo);
    if (!pie) return;
    pie.aviso.textContent = '';
    pie.aviso.hidden = true;
    pie.contenedor.hidden = !conContador;
}

function valorCandidatoCampo(campo, texto) {
    const valor = String(campo.value ?? '');
    const inicio = campo.selectionStart ?? valor.length;
    const fin = campo.selectionEnd ?? valor.length;
    return valor.slice(0, inicio) + texto + valor.slice(fin);
}

// ------------------------------------------------------------
// Nombre y Apellido: máximo 60 caracteres, contador en vivo, bloqueo
// al llegar a 60 y rechazo de pegado/arrastre sin truncamiento silencioso.
// ------------------------------------------------------------
function prepararInputsNombreApellido() {
    const MAX_NOMBRE = 60;
    const FORMULARIOS_NOMBRE = new Set([
        'form-paciente',
        'form-editar-paciente',
        'form-agregar-tutor',
        'form-editar-tutor',
        'form-nuevo-profesional',
        'form-profesional',
    ]);
    const CAMPOS_NOMBRE = new Set(['nombre', 'apellido', 'tutor_nombre', 'tutor_apellido']);
    const CAMPOS_COMBOBOX_BUSQUEDA = new Set(['tutor-nombre', 'add-tutor-nombre']);
    const estados = new WeakMap();

    const esCampoNombre = el => el instanceof HTMLInputElement
        && (FORMULARIOS_NOMBRE.has(el.form?.id) || el.dataset?.nombrePersonal === 'true')
        && CAMPOS_NOMBRE.has(el.name);

    const largoCaracteres = texto => [...String(texto ?? '')].length;

    const actualizarContador = (campo) => {
        const pie = obtenerPiePreventivo(campo, { conContador: true });
        if (!pie?.contador) return;
        const longitud = largoCaracteres(campo.value);
        const enTope = longitud >= MAX_NOMBRE;
        pie.contador.textContent = enTope
            ? `${longitud}/${MAX_NOMBRE} — Límite alcanzado`
            : `${longitud}/${MAX_NOMBRE}`;
        pie.contador.className = longitud > MAX_NOMBRE
            ? 'ms-auto flex-shrink-0 text-danger fw-semibold'
            : enTope
                ? 'ms-auto flex-shrink-0 text-warning-emphasis fw-semibold'
                : 'ms-auto flex-shrink-0 text-muted';
    };

    const validarContenidoNombre = (campo, { alSalir = false } = {}) => {
        const estado = estados.get(campo);
        actualizarContador(campo);

        if (estado?.avisoPegado && alSalir) {
            return false;
        }

        if (estado && campo.value === estado.original) {
            limpiarAvisoPreventivo(campo, { quitarInvalido: true, conContador: true });
            return true;
        }

        const longitud = largoCaracteres(campo.value);
        if (longitud > MAX_NOMBRE) {
            mostrarAvisoPreventivo(campo, `No puede superar los ${MAX_NOMBRE} caracteres.`, { invalido: true, conContador: true });
            return false;
        }

        const esBusquedaTutor = CAMPOS_COMBOBOX_BUSQUEDA.has(campo.id);
        const texto = String(campo.value ?? '').trim().replace(/\s+/gu, ' ');
        if (!texto) {
            limpiarAvisoPreventivo(campo, { quitarInvalido: true, conContador: true });
            return true;
        }
        if (esBusquedaTutor && (!alSalir || campo.dataset?.valor)) {
            limpiarAvisoPreventivo(campo, { quitarInvalido: true, conContador: true });
            return true;
        }
        if (!/^[\p{L}\s\-'\u2019]+$/u.test(texto)) {
            mostrarAvisoPreventivo(campo, 'Solo se permiten letras, espacios, guiones y apóstrofes.', { invalido: true, conContador: true });
            return false;
        }
        if (!/\p{L}/u.test(texto)) {
            mostrarAvisoPreventivo(campo, 'Debe contener al menos una letra.', { invalido: true, conContador: true });
            return false;
        }
        limpiarAvisoPreventivo(campo, { quitarInvalido: true, conContador: true });
        return true;
    };

    const sincronizarCampo = (campo) => {
        if (!esCampoNombre(campo)) return;
        estados.set(campo, { original: campo.value, ultimo: campo.value, avisoPegado: false });
        limpiarAvisoPreventivo(campo, { quitarInvalido: true, conContador: true });
        actualizarContador(campo);
    };

    const procesarPegado = (evento, campo, texto) => {
        const limpio = String(texto ?? '').replace(/[\r\n]+/g, ' ');
        const candidato = valorCandidatoCampo(campo, limpio);
        const largoFinal = largoCaracteres(candidato);
        if (largoFinal > MAX_NOMBRE) {
            if (typeof evento.preventDefault === 'function') {
                evento.preventDefault();
            }
            const estado = estados.get(campo) ?? { original: campo.value, ultimo: campo.value };
            estado.avisoPegado = true;
            estados.set(campo, estado);
            actualizarContador(campo);
            mostrarAvisoPreventivo(
                campo,
                `No se pegó el texto: supera el máximo de ${MAX_NOMBRE} caracteres (${largoFinal}/${MAX_NOMBRE}).`,
                { invalido: false, conContador: true },
            );
            return;
        }
        if (typeof evento.preventDefault === 'function') {
            evento.preventDefault();
        }
        const estado = estados.get(campo);
        if (estado) estado.avisoPegado = false;
        campo.setRangeText(limpio, campo.selectionStart ?? campo.value.length,
            campo.selectionEnd ?? campo.value.length, 'end');
        campo.dispatchEvent(new Event('input', { bubbles: true }));
    };

    document.addEventListener('focusin', evento => {
        const campo = evento.target;
        if (!esCampoNombre(campo)) return;
        const previo = estados.get(campo);
        if (!previo || previo.ultimo !== campo.value) {
            sincronizarCampo(campo);
        } else {
            actualizarContador(campo);
        }
    });

    document.addEventListener('paste', evento => {
        if (!esCampoNombre(evento.target)) return;
        if (!evento.clipboardData) {
            evento.preventDefault();
            mostrarAvisoPreventivo(evento.target, 'No se pudo leer el pegado.', { conContador: true });
            return;
        }
        procesarPegado(evento, evento.target, evento.clipboardData.getData('text/plain'));
    });

    document.addEventListener('drop', evento => {
        if (esCampoNombre(evento.target) && evento.dataTransfer) {
            procesarPegado(evento, evento.target, evento.dataTransfer.getData('text/plain'));
        }
    });

    document.addEventListener('beforeinput', evento => {
        const campo = evento.target;
        if (!esCampoNombre(campo) || evento.isComposing || !evento.cancelable) return;
        const tipo = evento.inputType ?? '';
        if (!tipo.startsWith('insert')) return;
        const texto = evento.data ?? evento.dataTransfer?.getData('text/plain');
        if (texto == null) return;

        if (tipo === 'insertFromPaste' || tipo === 'insertFromDrop') {
            procesarPegado(evento, campo, texto);
            return;
        }

        const candidato = valorCandidatoCampo(campo, texto);
        if (largoCaracteres(candidato) > MAX_NOMBRE) {
            evento.preventDefault();
            actualizarContador(campo);
            mostrarAvisoPreventivo(
                campo,
                `Alcanzaste el máximo de ${MAX_NOMBRE} caracteres.`,
                { invalido: false, conContador: true },
            );
        }
    });

    const alActualizarNombre = campo => {
        const estado = estados.get(campo) ?? { original: null, ultimo: '', avisoPegado: false };
        estado.ultimo = campo.value;
        estado.avisoPegado = false;
        estados.set(campo, estado);
        validarContenidoNombre(campo, { alSalir: false });
    };

    document.addEventListener('input', evento => {
        const campo = evento.target;
        if (!esCampoNombre(campo) || evento.isComposing) return;
        alActualizarNombre(campo);
    });

    document.addEventListener('compositionend', evento => {
        const campo = evento.target;
        if (!esCampoNombre(campo)) return;
        alActualizarNombre(campo);
    });

    document.addEventListener('focusout', evento => {
        const campo = evento.target;
        if (!esCampoNombre(campo)) return;
        const estado = estados.get(campo);
        if (estado) estado.ultimo = campo.value;
        validarContenidoNombre(campo, { alSalir: true });
    });

    const reiniciarContenedor = (raiz) => {
        for (const campo of raiz?.elements ?? raiz?.querySelectorAll?.('input') ?? []) {
            sincronizarCampo(campo);
        }
    };

    if (typeof document.querySelectorAll === 'function') {
        for (const campo of document.querySelectorAll('input')) {
            sincronizarCampo(campo);
        }
    }
    document.addEventListener('reset', evento => reiniciarContenedor(evento.target), true);
    document.addEventListener('show.bs.modal', evento => {
        reiniciarContenedor(evento.target);
        queueMicrotask(() => reiniciarContenedor(evento.target));
    }, true);
    document.addEventListener('hidden.bs.modal', evento => reiniciarContenedor(evento.target), true);
    document.addEventListener('eduges:sincronizar-campos', evento => reiniciarContenedor(evento.target), true);
}

// ------------------------------------------------------------
// Etapa 2: validaci?n preventiva en vivo (l?mites, pegado sin truncar,
// emails y domicilios al salir del campo, preservando hist?ricos intactos).
// ------------------------------------------------------------
function prepararInputsEtapa2() {
    const REGLAS_ETAPA2 = {
        'form-paciente': {
            mail: { max: 50, tipo: 'email' },
            direccion: { max: 255, noEmail: true },
            numero_afiliado: { max: 20 },
            cud_numero: { max: 20 },
            tutor_telefono: { max: 30 },
            tutor_movil: { max: 30 },
            tutor_mail: { max: 150, tipo: 'email' },
            tutor_domicilio: { max: 225, noEmail: true },
        },
        'form-editar-paciente': {
            direccion: { max: 255, noEmail: true },
            mail: { max: 50, tipo: 'email' },
            cud_numero: { max: 20 },
            numero_afiliado: { max: 20 },
        },
        'form-agregar-tutor': {
            telefono: { max: 30 },
            movil: { max: 30 },
            mail: { max: 150, tipo: 'email' },
            domicilio: { max: 225, noEmail: true },
        },
        'form-editar-tutor': {
            telefono: { max: 30 },
            movil: { max: 30 },
            mail: { max: 150, tipo: 'email' },
            domicilio: { max: 225, noEmail: true },
        },
        'form-nuevo-profesional': {
            matricula: { max: 50 },
            contacto: { max: 50 },
            mail: { max: 50, tipo: 'email' },
            usuario: { max: 100, sinEspacios: true },
        },
        'form-profesional': {
            matricula: { max: 50 },
            contacto: { max: 50 },
            mail: { max: 50, tipo: 'email' },
        },
        'form-nueva-especialidad': {
            nombre: { max: 100 },
        },
        'form-nuevo-usuario': {
            usuario: { max: 100, sinEspacios: true },
            password: { max: 128, ocultarContador: true },
            password_confirm: { max: 128, ocultarContador: true },
        },
        'form-crear-obra-social': {
            nombre: { max: 150 },
            contacto: { max: 150 },
            mail: { max: 150, tipo: 'email' },
            web: { max: 255, tipo: 'url' },
        },
    };
    const estados = new WeakMap();
    const largoCaracteres = texto => [...String(texto ?? '')].length;

    const reglaDeCampo = el => {
        if (!(el instanceof HTMLInputElement)) return null;
        const formId = el.form?.id;
        return formId && REGLAS_ETAPA2[formId]?.[el.name] ? REGLAS_ETAPA2[formId][el.name] : null;
    };

    const actualizarContador = (campo, regla) => {
        if (regla.ocultarContador) return;
        const longitud = largoCaracteres(campo.value);
        const mostrarContador = longitud >= Math.ceil(regla.max * 0.8);
        const pie = piesPreventivos.get(campo) || (mostrarContador ? obtenerPiePreventivo(campo, { conContador: true }) : null);
        if (!pie?.contador) return;
        if (!mostrarContador && pie.aviso.hidden) {
            pie.contador.textContent = '';
            pie.contenedor.hidden = true;
            return;
        }
        const enTope = longitud >= regla.max;
        pie.contador.textContent = enTope
            ? `${longitud}/${regla.max} \u2014 L\u00edmite alcanzado`
            : `${longitud}/${regla.max}`;
        pie.contador.className = longitud > regla.max
            ? 'ms-auto flex-shrink-0 text-danger fw-semibold'
            : enTope
                ? 'ms-auto flex-shrink-0 text-warning-emphasis fw-semibold'
                : 'ms-auto flex-shrink-0 text-muted';
        pie.contenedor.hidden = false;
    };

    const mostrarAvisoEtapa2 = (campo, regla, texto, { invalido = false } = {}) => {
        mostrarAvisoPreventivo(campo, texto, { invalido, conContador: !regla.ocultarContador });
        actualizarContador(campo, regla);
    };

    const limpiarAvisoEtapa2 = (campo, regla) => {
        limpiarAvisoPreventivo(campo, { quitarInvalido: true, conContador: false });
        actualizarContador(campo, regla);
    };

    const validarCampo = (campo, regla, { alSalir = false } = {}) => {
        const estado = estados.get(campo);
        if (estado?.avisoPegado && alSalir) {
            return false;
        }
        if (estado && campo.value === estado.original) {
            limpiarAvisoEtapa2(campo, regla);
            return true;
        }
        const longitud = largoCaracteres(campo.value);
        if (longitud > regla.max) {
            mostrarAvisoEtapa2(campo, regla, `No puede superar los ${regla.max} caracteres.`, { invalido: true });
            return false;
        }
        if (regla.sinEspacios && /\s/.test(campo.value)) {
            mostrarAvisoEtapa2(campo, regla, 'El usuario no puede contener espacios.', { invalido: true });
            return false;
        }
        if (alSalir) {
            const recortado = String(campo.value ?? '').trim();
            if (recortado && regla.noEmail && typeof errorDomicilio === 'function') {
                const errDom = errorDomicilio(recortado);
                if (errDom) {
                    mostrarAvisoEtapa2(campo, regla, errDom, { invalido: true });
                    return false;
                }
            }
            if (recortado && (regla.tipo === 'email' || regla.tipo === 'url') && typeof validarCamposPreventivos === 'function') {
                const errs = validarCamposPreventivos({ [campo.name]: recortado }, { [campo.name]: { max: regla.max, tipo: regla.tipo } });
                if (errs[campo.name]?.length) {
                    mostrarAvisoEtapa2(campo, regla, errs[campo.name][0], { invalido: true });
                    return false;
                }
            }
        }
        limpiarAvisoEtapa2(campo, regla);
        return true;
    };

    const sincronizarCampo = (campo) => {
        const regla = reglaDeCampo(campo);
        if (!regla) return;
        estados.set(campo, { original: campo.value, ultimo: campo.value, avisoPegado: false });
        limpiarAvisoEtapa2(campo, regla);
    };

    const procesarPegado = (evento, campo, regla, textoCrudo) => {
        if (regla.ocultarContador && /[\r\n]/.test(String(textoCrudo ?? ''))) {
            if (typeof evento.preventDefault === 'function') evento.preventDefault();
            const estado = estados.get(campo) ?? { original: campo.value, ultimo: campo.value };
            estado.avisoPegado = true;
            estados.set(campo, estado);
            mostrarAvisoEtapa2(campo, regla, 'La contrase\u00f1a no admite saltos de l\u00ednea.');
            return;
        }
        const texto = regla.ocultarContador
            ? String(textoCrudo ?? '')
            : String(textoCrudo ?? '').replace(/[\r\n]+/g, ' ');
        const candidato = valorCandidatoCampo(campo, texto);
        const largoFinal = largoCaracteres(candidato);
        if (largoFinal > regla.max) {
            if (typeof evento.preventDefault === 'function') evento.preventDefault();
            const estado = estados.get(campo) ?? { original: campo.value, ultimo: campo.value };
            estado.avisoPegado = true;
            estados.set(campo, estado);
            mostrarAvisoEtapa2(
                campo,
                regla,
                `No se peg\u00f3 el texto: supera el m\u00e1ximo de ${regla.max} caracteres (${largoFinal}/${regla.max}).`,
            );
            return;
        }
        if (typeof evento.preventDefault === 'function') evento.preventDefault();
        const estado = estados.get(campo);
        if (estado) estado.avisoPegado = false;
        campo.setRangeText(texto, campo.selectionStart ?? campo.value.length,
            campo.selectionEnd ?? campo.value.length, 'end');
        campo.dispatchEvent(new Event('input', { bubbles: true }));
    };

    document.addEventListener('focusin', evento => {
        const campo = evento.target;
        const regla = reglaDeCampo(campo);
        if (!regla) return;
        const previo = estados.get(campo);
        if (!previo || previo.ultimo !== campo.value) {
            sincronizarCampo(campo);
        } else {
            actualizarContador(campo, regla);
        }
    });

    document.addEventListener('paste', evento => {
        const campo = evento.target;
        const regla = reglaDeCampo(campo);
        if (!regla) return;
        if (!evento.clipboardData) {
            evento.preventDefault();
            mostrarAvisoEtapa2(campo, regla, 'No se pudo leer el pegado.');
            return;
        }
        procesarPegado(evento, campo, regla, evento.clipboardData.getData('text/plain'));
    });

    document.addEventListener('drop', evento => {
        const campo = evento.target;
        const regla = reglaDeCampo(campo);
        if (regla && evento.dataTransfer) {
            procesarPegado(evento, campo, regla, evento.dataTransfer.getData('text/plain'));
        }
    });

    document.addEventListener('beforeinput', evento => {
        const campo = evento.target;
        const regla = reglaDeCampo(campo);
        if (!regla || evento.isComposing || !evento.cancelable) return;
        const tipo = evento.inputType ?? '';
        if (!tipo.startsWith('insert')) return;
        const texto = evento.data ?? evento.dataTransfer?.getData('text/plain');
        if (texto == null) return;

        if (tipo === 'insertFromPaste' || tipo === 'insertFromDrop') {
            procesarPegado(evento, campo, regla, texto);
            return;
        }

        const candidato = valorCandidatoCampo(campo, texto);
        if (largoCaracteres(candidato) > regla.max) {
            evento.preventDefault();
            mostrarAvisoEtapa2(campo, regla, `Alcanzaste el m\u00e1ximo de ${regla.max} caracteres.`);
        }
    });

    const alActualizar = campo => {
        const regla = reglaDeCampo(campo);
        if (!regla) return;
        const estado = estados.get(campo) ?? { original: null, ultimo: '', avisoPegado: false };
        estado.ultimo = campo.value;
        estado.avisoPegado = false;
        estados.set(campo, estado);
        validarCampo(campo, regla, { alSalir: false });
    };

    document.addEventListener('input', evento => {
        if (!evento.isComposing) alActualizar(evento.target);
    });

    document.addEventListener('compositionend', evento => alActualizar(evento.target));

    document.addEventListener('focusout', evento => {
        const campo = evento.target;
        const regla = reglaDeCampo(campo);
        if (!regla) return;
        const estado = estados.get(campo);
        if (estado) estado.ultimo = campo.value;
        validarCampo(campo, regla, { alSalir: true });
    });

    const reiniciarContenedor = (raiz) => {
        for (const campo of raiz?.elements ?? raiz?.querySelectorAll?.('input') ?? []) {
            sincronizarCampo(campo);
        }
    };

    if (typeof document.querySelectorAll === 'function') {
        for (const campo of document.querySelectorAll('input')) {
            sincronizarCampo(campo);
        }
    }
    document.addEventListener('reset', evento => reiniciarContenedor(evento.target), true);
    document.addEventListener('show.bs.modal', evento => {
        reiniciarContenedor(evento.target);
        queueMicrotask(() => reiniciarContenedor(evento.target));
    }, true);
    document.addEventListener('hidden.bs.modal', evento => reiniciarContenedor(evento.target), true);
    document.addEventListener('eduges:sincronizar-campos', evento => reiniciarContenedor(evento.target), true);
}

async function iniciar() {
    prepararModalesApilados();
    prepararMenuMovil();
    inicializarDesplegablesNav();
    prepararInputsDni();
    prepararInputsNombreApellido();
    prepararInputsEtapa2();
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
