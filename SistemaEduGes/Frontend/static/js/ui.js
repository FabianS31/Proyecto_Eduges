// ============================================================
// EduGes - Utilidades de interfaz
// Formato de datos, HTML seguro, estados de carga/vacío/error,
// avisos (toasts) y errores de formularios.
// Usa Bootstrap 5 (cargado en base.html como window.bootstrap).
// ============================================================

import { ApiError } from './api.js';
import { DIAS_AVISO_CUD } from './constantes.js';
import { aFecha, diasEntre, hoyISO } from './fechas.js';

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

// { nombre: 'Lucas', apellido: 'Pérez' } → "Lucas Pérez" o "Pérez, Lucas"
export function nombreCompleto(persona, { apellidoPrimero = false } = {}) {
    if (!persona) {
        return '—';
    }
    return apellidoPrimero ? `${persona.apellido}, ${persona.nombre}` : `${persona.nombre} ${persona.apellido}`;
}

// ============================================================
// CUD (Certificado Único de Discapacidad)
// Vencido, por vencer (dentro de DIAS_AVISO_CUD días) o vigente,
// siempre con ícono y texto (no solo color).
// ============================================================
export const CUD = Object.freeze({ VENCIDO: 'vencido', POR_VENCER: 'por_vencer', VIGENTE: 'vigente' });

export function estadoCud(vencimiento) {
    const dias = diasEntre(hoyISO(), vencimiento);
    if (dias < 0) {
        return {
            clave: CUD.VENCIDO,
            dias,
            texto: dias === -1 ? 'Venció ayer' : `Venció hace ${-dias} días`,
            clase: 'badge-cud-vencido',
            icono: 'bi-x-octagon',
        };
    }
    if (dias <= DIAS_AVISO_CUD) {
        let texto = `Vence en ${dias} días`;
        if (dias === 0) {
            texto = 'Vence hoy';
        } else if (dias === 1) {
            texto = 'Vence mañana';
        }
        return { clave: CUD.POR_VENCER, dias, texto, clase: 'badge-cud-alerta', icono: 'bi-exclamation-triangle' };
    }
    return {
        clave: CUD.VIGENTE,
        dias,
        texto: `Vigente hasta ${formatearFecha(vencimiento)}`,
        clase: 'badge-cud-vigente',
        icono: 'bi-shield-check',
    };
}

export function badgeCud(vencimiento) {
    const cud = estadoCud(vencimiento);
    return html`<span class="badge ${cud.clase}"><i class="bi ${cud.icono} me-1" aria-hidden="true"></i>${cud.texto}</span>`;
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
