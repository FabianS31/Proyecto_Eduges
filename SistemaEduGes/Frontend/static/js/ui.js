// ============================================================
// EduGes - Utilidades de interfaz
// Formato de datos, HTML seguro, estados de carga/vacío/error,
// avisos (toasts), confirmaciones y errores de formularios.
// Usa Bootstrap 5 (cargado en base.html como window.bootstrap).
// ============================================================

import { ApiError } from './api.js';
import { CUD_ESTADO, ESTADO_TURNO } from './constantes.js';
import { aFecha } from './fechas.js';

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

export function escaparHtml(valor) {
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

// "14:30:00" → "14:30"
export function formatearHora(hora) {
    return hora ? hora.slice(0, 5) : '—';
}

// "2026-09-26T14:30:12-03:00" → "26/09/2026 14:30" (hora tal como la informa la API)
export function formatearFechaHora(isoCompleto) {
    if (!isoCompleto) {
        return '—';
    }
    return `${formatearFecha(isoCompleto)} ${isoCompleto.slice(11, 16)}`;
}

// { nombre: 'Lucas', apellido: 'Pérez' } → "Lucas Pérez" o "Pérez, Lucas"
export function nombreCompleto(persona, { apellidoPrimero = false } = {}) {
    if (!persona) {
        return '—';
    }
    return apellidoPrimero ? `${persona.apellido}, ${persona.nombre}` : `${persona.nombre} ${persona.apellido}`;
}

// Días hasta el vencimiento del CUD → texto para mostrar
export function textoVencimientoCud(dias) {
    if (dias < -1) {
        return `Vencido hace ${-dias} días`;
    }
    if (dias === -1) {
        return 'Venció ayer';
    }
    if (dias === 0) {
        return 'Vence hoy';
    }
    if (dias === 1) {
        return 'Vence mañana';
    }
    return `Vence en ${dias} días`;
}

// ============================================================
// Badges
// ============================================================
const CLASE_ESTADO_TURNO = {
    [ESTADO_TURNO.PENDIENTE]: 'badge-turno-pendiente',
    [ESTADO_TURNO.CONFIRMADO]: 'badge-turno-confirmado',
    [ESTADO_TURNO.CANCELADO]: 'badge-turno-cancelado',
    [ESTADO_TURNO.REALIZADO]: 'badge-turno-realizado',
};

export function badgeEstadoTurno(estado) {
    const clase = CLASE_ESTADO_TURNO[estado?.id] ?? 'bg-secondary';
    return html`<span class="badge ${clase}">${estado?.nombre ?? 'Sin estado'}</span>`;
}

const ESTILO_CUD = {
    [CUD_ESTADO.VENCIDO]: { clase: 'badge-cud-vencido', texto: 'CUD vencido' },
    [CUD_ESTADO.POR_VENCER]: { clase: 'badge-cud-alerta', texto: 'CUD por vencer' },
    [CUD_ESTADO.VIGENTE]: { clase: 'badge-cud-ok', texto: 'CUD vigente' },
};

export function badgeCud(cudEstado) {
    const estilo = ESTILO_CUD[cudEstado];
    return estilo ? html`<span class="badge ${estilo.clase}">${estilo.texto}</span>` : html``;
}

// ============================================================
// Estados de un bloque: cargando, vacío y error
// ============================================================
export function bloqueCargando(lineas = 3) {
    const anchos = ['col-7', 'col-10', 'col-5', 'col-8', 'col-6'];
    const filas = Array.from({ length: lineas }, (_, i) =>
        html`<span class="placeholder ${anchos[i % anchos.length]} mb-2 d-block rounded"></span>`);
    return html`
        <div class="placeholder-glow p-3" aria-busy="true">
            ${filas}
            <span class="visually-hidden" role="status">Cargando…</span>
        </div>`;
}

export function bloqueVacio(mensaje, icono = 'bi-inbox') {
    return html`
        <div class="text-center text-muted py-4 px-3">
            <i class="bi ${icono} fs-3 d-block mb-2 text-secondary" aria-hidden="true"></i>
            ${mensaje}
        </div>`;
}

export function bloqueError(mensaje) {
    return html`
        <div class="text-center py-4 px-3" role="alert">
            <i class="bi bi-exclamation-triangle fs-3 d-block mb-2 text-danger" aria-hidden="true"></i>
            <div class="small text-danger mb-2">${mensaje}</div>
            <button type="button" class="btn btn-sm btn-outline-secondary" data-accion="reintentar">
                <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Reintentar
            </button>
        </div>`;
}

// Para mostrar un estado dentro de un <tbody>
export function filaCompleta(colspan, contenido) {
    return html`<tr><td colspan="${colspan}" class="p-0 border-0">${contenido}</td></tr>`;
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
export function mostrarError(contenedor, error, reintentar, { colspan } = {}) {
    const mensaje = mensajeDeError(error);
    if (mensaje === null) {
        return;
    }
    renderizar(contenedor, colspan ? filaCompleta(colspan, bloqueError(mensaje)) : bloqueError(mensaje));
    const boton = contenedor.querySelector('[data-accion="reintentar"]');
    if (boton && reintentar) {
        boton.addEventListener('click', reintentar, { once: true });
    }
}

// ============================================================
// Avisos (toasts)
// ============================================================
const ESTILO_AVISO = {
    exito: { clase: 'text-bg-success', icono: 'bi-check-circle-fill', duracion: 4000 },
    info: { clase: 'text-bg-primary', icono: 'bi-info-circle-fill', duracion: 4000 },
    error: { clase: 'text-bg-danger', icono: 'bi-exclamation-triangle-fill', duracion: 8000 },
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
            <div class="toast-body"><i class="bi ${estilo.icono} me-2" aria-hidden="true"></i>${mensaje}</div>
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
// Confirmación (reemplaza a window.confirm, que bloquea la página)
//   if (await confirmar({ mensaje: '¿Cancelar el turno?', peligro: true })) { ... }
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
            <div class="modal-dialog modal-dialog-centered modal-sm">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header border-0 pb-0">
                        <h5 class="modal-title fs-6 fw-bold" id="${idTitulo}">${titulo}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                    </div>
                    <div class="modal-body small text-muted">${mensaje}</div>
                    <div class="modal-footer border-0 pt-0">
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">${textoCancelar}</button>
                        <button type="button" class="btn btn-sm ${peligro ? 'btn-danger' : 'btn-eduges'}" data-accion="aceptar">${textoAceptar}</button>
                    </div>
                </div>
            </div>`);
        document.body.append(dialogo);

        // Al cerrar, el foco vuelve a donde estaba (Bootstrap solo lo hace si el modal se abrió con data-bs-toggle)
        const focoAnterior = document.activeElement;
        const modal = new window.bootstrap.Modal(dialogo);
        let aceptado = false;
        let visible = false;
        dialogo.addEventListener('shown.bs.modal', () => {
            visible = true;
            // El foco arranca en "Volver": un Enter apurado no confirma una acción peligrosa.
            // Además, si el diálogo se abrió desde un panel lateral, la trampa de foco del panel
            // puede habérselo robado al abrir: acá se recupera.
            dialogo.querySelector('.modal-footer [data-bs-dismiss="modal"]')?.focus();
        });
        // Bootstrap ignora el cierre durante la animación de apertura: en ese caso se cierra al terminar
        const cerrar = () => {
            if (visible) {
                modal.hide();
            } else {
                dialogo.addEventListener('shown.bs.modal', () => modal.hide(), { once: true });
            }
        };
        dialogo.querySelector('[data-accion="aceptar"]').addEventListener('click', () => {
            aceptado = true;
            cerrar();
        });
        dialogo.querySelectorAll('[data-bs-dismiss="modal"]').forEach((boton) => {
            boton.addEventListener('click', () => {
                if (!visible) {
                    cerrar();
                }
            });
        });
        dialogo.addEventListener('hidden.bs.modal', () => {
            modal.dispose();
            dialogo.remove();
            if (focoAnterior?.isConnected) {
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
        campo.insertAdjacentElement('afterend', feedback);
    }

    if (sinCampo.length === 0 && Object.keys(error.erroresDeCampo).length === 0) {
        sinCampo.push(error.message);
    }
    return sinCampo;
}
