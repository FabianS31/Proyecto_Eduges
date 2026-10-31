// ============================================================
// EduGes - Utilidades de interfaz
// Formato de datos, HTML seguro, estados de carga/vacío/error,
// avisos (toasts) y errores de formularios.
// Usa Bootstrap 5 (cargado en base.html como window.bootstrap).
// ============================================================

import { ApiError } from './api.js';
import { MESES_AVISO_CUD } from './constantes.js';
import { aFecha, diasEntre, hoyISO, sumarMeses } from './fechas.js';

// ============================================================
// HTML seguro
// Todo lo que viene de la API se escapa antes de insertarse en la página,
// para que un nombre como "<script>" se muestre como texto y no se ejecute.
//
//   renderizar(tbody, html`<td>${paciente.apellido}</td>`);
//
// Dentro de html`...` los valores se escapan solos; un html`...` anidado o un
// array de html`...` se insertan tal cual. null, undefined y false no muestran nada.
// ============================================================
class HtmlSeguro {
    constructor(texto) {
        this.texto = texto;
    }

    toString() {
        return this.texto;
    }
}

const ENTIDADES_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escaparHtml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (c) => ENTIDADES_HTML[c]);
}

function aTextoHtml(valor) {
    if (valor instanceof HtmlSeguro) {
        return valor.texto;
    }
    if (Array.isArray(valor)) {
        return valor.map(aTextoHtml).join('');
    }
    if (valor === null || valor === undefined || valor === false) {
        return '';
    }
    return escaparHtml(valor);
}

export function html(partes, ...valores) {
    let resultado = partes[0];
    valores.forEach((valor, i) => {
        resultado += aTextoHtml(valor) + partes[i + 1];
    });
    return new HtmlSeguro(resultado);
}

// Reemplaza el contenido de un elemento. Un string común se inserta como texto.
export function renderizar(elemento, contenido) {
    elemento.innerHTML = aTextoHtml(contenido);
}

// ============================================================
// Formato de datos
// ============================================================
const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
});

// "2026-09-26" → "26/09/2026"
export function formatearFecha(iso) {
    if (!iso) {
        return '—';
    }
    const [anio, mes, dia] = iso.slice(0, 10).split('-');
    return `${dia}/${mes}/${anio}`;
}

// "2026-09-26" → "Sábado, 26 de septiembre de 2026"
export function formatearFechaLarga(iso) {
    if (!iso) {
        return '—';
    }
    const texto = FORMATO_FECHA_LARGA.format(aFecha(iso));
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Mail y teléfono como enlaces (abren el correo o el marcador del celular); "—" si no hay
export function enlaceMail(mail) {
    if (!mail) {
        return html`<span class="text-muted">—</span>`;
    }
    return html`<a href="mailto:${mail}" class="link-secondary text-break">${mail}</a>`;
}

export function enlaceTelefono(telefono) {
    if (!telefono) {
        return html`<span class="text-muted">—</span>`;
    }
    return html`<a href="tel:${telefono.replace(/[^\d+]/g, '')}" class="link-secondary">${telefono}</a>`;
}

// Capitaliza texto a Title Case (ej.: "juan pablo pérez" → "Juan Pablo Pérez")
export function capitalizar(texto) {
    if (!texto) {
        return '';
    }
    return String(texto)
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1))
        .join(' ');
}

// { nombre: 'Lucas', apellido: 'Pérez' } → "Lucas Pérez" o "Pérez, Lucas"
export function nombreCompleto(persona, { apellidoPrimero = false } = {}) {
    if (!persona) {
        return '—';
    }
    const nom = capitalizar(persona.nombre);
    const ape = capitalizar(persona.apellido);
    return apellidoPrimero ? `${ape}, ${nom}` : `${nom} ${ape}`;
}

// { nombre: 'Lucas', apellido: 'Pérez' } → "LP" (para los avatares)
export function iniciales(persona) {
    const primera = (texto) => String(texto ?? '').trim().charAt(0).toUpperCase();
    return `${primera(persona?.nombre)}${primera(persona?.apellido)}` || '?';
}

// Ícono de Material Symbols (decorativo: el texto de al lado dice qué es)
export function icono(nombre, clase = '') {
    return html`<span class="ms ${clase}" aria-hidden="true">${nombre}</span>`;
}

// ============================================================
// CUD (Certificado Único de Discapacidad)
// Vencido, por vencer (dentro de DIAS_AVISO_CUD días) o vigente,
// siempre con ícono y texto (no solo color).
// ============================================================
export const CUD = Object.freeze({ VENCIDO: 'vencido', POR_VENCER: 'por_vencer', VIGENTE: 'vigente' });

export function estadoCud(vencimiento) {
    const dias = diasEntre(hoyISO(), vencimiento);
    const fecha = formatearFecha(vencimiento);
    if (dias < 0) {
        return {
            clave: CUD.VENCIDO,
            dias,
            texto: dias === -1 ? 'Venció ayer' : `Venció hace ${-dias} días`,
            corto: 'Vencido',
            fecha: `Venció el ${fecha}`,
            clase: 'eg-chip--err',
            icono: 'error',
        };
    }
    if (vencimiento <= sumarMeses(hoyISO(), MESES_AVISO_CUD)) {
        let texto = `Vence en ${dias} días`;
        if (dias === 0) {
            texto = 'Vence hoy';
        } else if (dias === 1) {
            texto = 'Vence mañana';
        }
        return { clave: CUD.POR_VENCER, dias, texto, corto: 'Por vencer', fecha: `Vence el ${fecha}`, clase: 'eg-chip--warn', icono: 'schedule' };
    }
    return {
        clave: CUD.VIGENTE,
        dias,
        texto: `Vigente hasta ${fecha}`,
        corto: 'Vigente',
        fecha: `Hasta el ${fecha}`,
        clase: 'eg-chip--ok',
        icono: 'verified',
    };
}

// "Vence en 12 días", con color, ícono y texto (nunca solo color)
export function badgeCud(vencimiento) {
    const cud = estadoCud(vencimiento);
    return html`<span class="eg-chip ${cud.clase}">${icono(cud.icono)}${cud.texto}</span>`;
}

// Para las tablas: "Por vencer" y debajo "Vence el 02/12/2026"
export function celdaCud(vencimiento) {
    const cud = estadoCud(vencimiento);
    return html`
        <div class="eg-cud">
            <span class="eg-chip ${cud.clase}">${icono(cud.icono)}${cud.corto}</span>
            <span class="eg-cud__date">${cud.fecha}</span>
        </div>`;
}

// ============================================================
// Estados de un bloque: cargando, vacío y error
// ============================================================
export function bloqueCargando(lineas = 3) {
    const anchos = ['col-7', 'col-10', 'col-5', 'col-8', 'col-6'];
    const filas = Array.from({ length: lineas }, (_, i) =>
        html`<span class="placeholder ${anchos[i % anchos.length]} mb-2 d-block rounded"></span>`);
    return html`
        <div class="placeholder-glow eg-cargando" aria-busy="true">
            ${filas}
            <span class="visually-hidden" role="status">Cargando…</span>
        </div>`;
}

// nombreIcono: de Material Symbols (ej.: 'person_search'). accion: un botón opcional debajo.
export function bloqueVacio(mensaje, nombreIcono = 'inbox', accion = null) {
    return html`
        <div class="eg-empty eg-empty--compact">
            <div class="eg-empty__icon">${icono(nombreIcono)}</div>
            <span class="eg-empty__text">${mensaje}</span>
            ${accion}
        </div>`;
}

export function bloqueError(mensaje) {
    return html`
        <div class="eg-empty eg-empty--compact" role="alert">
            <div class="eg-empty__icon eg-empty__icon--error">${icono('error')}</div>
            <span class="eg-error__text">${mensaje}</span>
            <button type="button" class="eg-btn" data-accion="reintentar">${icono('refresh')}Reintentar</button>
        </div>`;
}

// Texto para mostrar al usuario a partir de cualquier error.
// Devuelve null si fue una cancelación (no hay nada que mostrar).
export function mensajeDeError(error) {
    if (error?.name === 'AbortError') {
        return null;
    }
    if (error instanceof ApiError) {
        return error.message;
    }
    console.error(error);
    return 'Ocurrió un error inesperado. Recargá la página e intentá de nuevo.';
}

// Muestra el error en el contenedor con un botón "Reintentar" que llama a reintentar()
export function mostrarError(contenedor, error, reintentar) {
    const mensaje = mensajeDeError(error);
    if (mensaje === null) {
        return;
    }
    renderizar(contenedor, bloqueError(mensaje));
    const boton = contenedor.querySelector('[data-accion="reintentar"]');
    if (boton && reintentar) {
        boton.addEventListener('click', reintentar, { once: true });
    }
}

// ============================================================
// Avisos (toasts)
// ============================================================
const ESTILO_AVISO = {
    exito: { clase: 'text-bg-success', icono: 'check_circle', duracion: 4000 },
    info: { clase: 'text-bg-primary', icono: 'info', duracion: 4000 },
    error: { clase: 'text-bg-danger', icono: 'warning', duracion: 8000 },
};

function contenedorDeAvisos() {
    let contenedor = document.getElementById('eduges-avisos');
    if (!contenedor) {
        contenedor = document.createElement('div');
        contenedor.id = 'eduges-avisos';
        contenedor.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.append(contenedor);
    }
    return contenedor;
}

// tipo: 'exito' | 'info' | 'error'
export function notificar(mensaje, tipo = 'exito') {
    const estilo = ESTILO_AVISO[tipo] ?? ESTILO_AVISO.info;
    const aviso = document.createElement('div');
    aviso.className = `toast align-items-center border-0 ${estilo.clase}`;
    aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    aviso.setAttribute('aria-live', tipo === 'error' ? 'assertive' : 'polite');
    renderizar(aviso, html`
        <div class="d-flex">
            <div class="toast-body">${icono(estilo.icono)}${mensaje}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button>
        </div>`);

    contenedorDeAvisos().append(aviso);
    aviso.addEventListener('hidden.bs.toast', () => aviso.remove());

    if (window.bootstrap?.Toast) {
        new window.bootstrap.Toast(aviso, { delay: estilo.duracion }).show();
    } else {
        aviso.classList.add('show');
        setTimeout(() => aviso.remove(), estilo.duracion);
    }
}

export function notificarError(error) {
    const mensaje = mensajeDeError(error);
    if (mensaje !== null) {
        notificar(mensaje, 'error');
    }
}

// ============================================================
// Confirmación antes de una acción que no se puede deshacer
// (reemplaza a window.confirm, que bloquea la página y no se puede leer bien)
//   if (await confirmar({ titulo: '¿Cancelar el turno?', mensaje: '…', peligro: true })) { … }
// El foco arranca en "Volver": un Enter apurado no confirma una acción peligrosa.
// ============================================================
let contadorDialogos = 0;

export function confirmar({
    titulo = '¿Confirmás la acción?',
    mensaje = '',
    textoAceptar = 'Aceptar',
    textoCancelar = 'Volver',
    peligro = false,
} = {}) {
    return new Promise((resolver) => {
        const idTitulo = `eduges-confirmar-${++contadorDialogos}`;
        const dialogo = document.createElement('div');
        dialogo.className = 'modal fade';
        dialogo.tabIndex = -1;
        dialogo.setAttribute('aria-labelledby', idTitulo);
        dialogo.setAttribute('aria-hidden', 'true');
        renderizar(dialogo, html`
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header border-0 pb-0">
                        <h2 class="modal-title fs-6 fw-bold" id="${idTitulo}">${titulo}</h2>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                    </div>
                    <div class="modal-body">${mensaje}</div>
                    <div class="modal-footer border-0 pt-0">
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">${textoCancelar}</button>
                        <button type="button" class="btn btn-sm ${peligro ? 'btn-danger' : 'btn-eduges'}" data-accion="aceptar">${textoAceptar}</button>
                    </div>
                </div>
            </div>`);
        document.body.append(dialogo);

        // Al cerrar, el foco vuelve a donde estaba (Bootstrap solo lo hace con data-bs-toggle)
        const focoAnterior = document.activeElement;
        const modal = new window.bootstrap.Modal(dialogo);
        let aceptado = false;
        dialogo.addEventListener('shown.bs.modal', () => {
            dialogo.querySelector('.modal-footer [data-bs-dismiss="modal"]')?.focus();
        });
        dialogo.querySelector('[data-accion="aceptar"]').addEventListener('click', () => {
            aceptado = true;
            modal.hide();
        });
        dialogo.addEventListener('hidden.bs.modal', () => {
            modal.dispose();
            dialogo.remove();
            if (focoAnterior?.isConnected && focoAnterior.checkVisibility()) {
                focoAnterior.focus();
            }
            resolver(aceptado);
        });
        modal.show();
    });
}

// ============================================================
// Botones y formularios
// ============================================================

// Ejecuta fn recién cuando pasaron "ms" sin nuevas llamadas (ej.: buscar mientras se escribe)
export function demorar(fn, ms = 300) {
    let temporizador = null;
    return (...args) => {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => fn(...args), ms);
    };
}

// Deshabilita el botón y muestra un spinner mientras dura una operación
export function botonCargando(boton, cargando, texto = 'Guardando…') {
    if (cargando) {
        if (boton.dataset.contenidoOriginal === undefined) {
            boton.dataset.contenidoOriginal = boton.innerHTML;
        }
        boton.disabled = true;
        renderizar(boton, html`<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>${texto}`);
    } else {
        boton.disabled = false;
        if (boton.dataset.contenidoOriginal !== undefined) {
            boton.innerHTML = boton.dataset.contenidoOriginal;
            delete boton.dataset.contenidoOriginal;
        }
    }
}

export function limpiarErroresFormulario(formulario) {
    formulario.querySelectorAll('.is-invalid').forEach((campo) => campo.classList.remove('is-invalid'));
    formulario.querySelectorAll('[data-error-de-campo]').forEach((nodo) => nodo.remove());
}

// Marca en rojo los campos con error (según su atributo name) y devuelve los
// mensajes que no corresponden a ningún campo visible, para mostrarlos aparte.
export function mostrarErroresFormulario(formulario, error) {
    limpiarErroresFormulario(formulario);
    if (!(error instanceof ApiError)) {
        const mensaje = mensajeDeError(error);
        return mensaje === null ? [] : [mensaje];
    }

    const sinCampo = [...error.erroresGenerales];
    for (const [nombre, mensajes] of Object.entries(error.erroresDeCampo)) {
        const campo = formulario.querySelector(`[name="${CSS.escape(nombre)}"]`);
        if (!campo) {
            sinCampo.push(...mensajes);
            continue;
        }
        campo.classList.add('is-invalid');
        const feedback = document.createElement('div');
        feedback.className = 'invalid-feedback';
        feedback.dataset.errorDeCampo = '';
        feedback.textContent = mensajes.join(' ');
        // Si el campo está en un input-group (ej.: contraseña con botón "Mostrar"), el mensaje
        // va debajo del grupo completo; si no, empujaría el botón a otro renglón
        (campo.closest('.input-group') ?? campo).insertAdjacentElement('afterend', feedback);
    }

    if (sinCampo.length === 0 && Object.keys(error.erroresDeCampo).length === 0) {
        sinCampo.push(error.message);
    }
    return sinCampo;
}
