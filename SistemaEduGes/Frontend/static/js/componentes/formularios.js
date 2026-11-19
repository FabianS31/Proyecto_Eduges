// ============================================================
// EduGes - Formularios en modales
// Lo común a todos los formularios: errores por campo y generales,
// limpieza al cerrar y el flujo de guardado (validar → enviar → avisar).
//
// Los name de los campos son las claves de error de la API: así un error
// como { dni: ['Ya existe...'] } se muestra debajo del campo DNI.
// ============================================================

import { ApiError } from '../api.js';
import {
    botonCargando,
    html,
    limpiarErroresFormulario,
    mostrarErroresFormulario,
    notificar,
    renderizar,
} from '../ui.js';

// Marca los campos con error y muestra arriba los errores que no son de un campo.
// El foco va al primer campo con error; si el error es general, al aviso.
export function mostrarErroresDelFormulario(formulario, contenedorErrores, error) {
    const generales = mostrarErroresFormulario(formulario, error);
    renderizar(contenedorErrores, generales.length > 0
        ? html`
            <div class="alert alert-danger py-2 small mb-3 d-flex align-items-start gap-2" role="alert">
                <span class="ms" aria-hidden="true">error</span>
                <span>${generales.join(' ')}</span>
            </div>`
        : '');
    const campo = formulario.querySelector('.is-invalid');
    const aviso = contenedorErrores.querySelector('[role="alert"]');
    if (campo) {
        campo.focus();
    } else if (aviso) {
        aviso.tabIndex = -1;
        aviso.focus();
    }
}

// Prepara el modal que contiene al formulario y devuelve una función para obtenerlo.
// comboboxes: los campos con sugerencias del formulario (se limpian al cerrar)
export function prepararModal({ modal, formulario, contenedorErrores, comboboxes = [], alAbrir }) {
    // Bootstrap solo devuelve el foco al cerrar si el modal se abrió con data-bs-toggle:
    // acá se abren por código, así que se recuerda quién lo abrió y se le devuelve
    let abiertoDesde = null;
    formulario.addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
    modal.addEventListener('show.bs.modal', () => {
        abiertoDesde = document.activeElement;
        alAbrir?.();
    });
    modal.addEventListener('shown.bs.modal', () => formulario.querySelector('input:not([type="hidden"])')?.focus());
    // Al cerrar no quedan datos ni errores en el formulario
    modal.addEventListener('hidden.bs.modal', () => {
        formulario.reset();
        comboboxes.forEach((combo) => combo.limpiar());
        limpiarErroresFormulario(formulario);
        renderizar(contenedorErrores, '');
        // Si quien lo abrió ya no está en pantalla (ej.: la ficha que se cerró para editar),
        // el foco lo maneja la pantalla
        if (abiertoDesde?.isConnected && abiertoDesde.checkVisibility()) {
            abiertoDesde.focus();
        }
        abiertoDesde = null;
    });
    return () => window.bootstrap.Modal.getOrCreateInstance(modal);
}

// errores: los de la validación en el navegador ({ campo: ['mensaje'] }); si hay, no se envía.
// enviar: la llamada a la API. alGuardar recibe lo que devolvió la API.
export async function guardar({ formulario, contenedorErrores, boton, errores, enviar, mensajeExito, modal, alGuardar }) {
    if (Object.keys(errores).length > 0) {
        mostrarErroresDelFormulario(formulario, contenedorErrores, new ApiError(400, errores));
        return;
    }
    limpiarErroresFormulario(formulario);
    renderizar(contenedorErrores, '');
    botonCargando(boton, true);
    try {
        const resultado = await enviar();
        modal().hide();
        notificar(typeof mensajeExito === 'function' ? mensajeExito(resultado) : mensajeExito);
        alGuardar?.(resultado);
    } catch (error) {
        mostrarErroresDelFormulario(formulario, contenedorErrores, error);
    } finally {
        botonCargando(boton, false);
    }
}


export function validarCud(datos, original = null) {
    const campos = ['cud_numero', 'cud_vencimiento'];
    if (original && !campos.some(campo => Object.hasOwn(datos, campo))) return {};
    const valor = campo => String((Object.hasOwn(datos, campo) ? datos[campo] : original?.[campo]) ?? '').trim();
    const numero = valor('cud_numero'), fecha = valor('cud_vencimiento');
    return Boolean(numero) === Boolean(fecha) ? {} : {
        [numero ? 'cud_vencimiento' : 'cud_numero']: ['Completá número y vencimiento del CUD juntos, o dejá ambos vacíos.'],
    };
}

export function errorDomicilio(valor) {
    // Solo un correo completo: no restringe el formato de las direcciones reales.
    const correo = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
    return correo.test(String(valor ?? '').trim())
        ? 'Ingresá un domicilio válido, no una dirección de correo electrónico' : null;
}

// Formatos de Django: dominios internacionales, localhost e IP literales.
const ETIQUETA_HOST = '[a-z\u00a1-\uffff0-9](?:[a-z\u00a1-\uffff0-9-]{0,61}[a-z\u00a1-\uffff0-9])?';
const DOMINIO = `${ETIQUETA_HOST}(?:\\.${ETIQUETA_HOST})*\\.(?!-)(?:[a-z\u00a1-\uffff-]{2,63}|xn--[a-z0-9]{1,59})(?<!-)`;
const IPV4 = '(?:0|25[0-5]|2[0-4][0-9]|1[0-9]?[0-9]?|[1-9][0-9]?)(?:\\.(?:0|25[0-5]|2[0-4][0-9]|1[0-9]?[0-9]?|[1-9][0-9]?)){3}';
function ipValida(valor) {
    if (new RegExp(`^${IPV4}$`).test(valor)) return true;
    if (!valor.includes(':')) return false;
    try { return new URL(`http://[${valor}]/`).hostname.startsWith('['); } catch { return false; }
}

export function validarNombrePersonal(valor, campo = 'nombre') {
    const texto = String(valor ?? '').trim().replace(/\s+/gu, ' ');
    if (!texto) return `Indicá el ${campo}.`;
    if ([...texto].length > 60) return `El ${campo} no puede superar los 60 caracteres.`;
    if (!/\p{L}/u.test(texto)) return 'Debe contener al menos una letra.';
    if (!/^[\p{L}\s\-'\u2019]+$/u.test(texto)) {
        return `El ${campo} solo puede contener letras, espacios, guiones y apóstrofes.`;
    }
    return null;
}

// Solo se validan campos enviados; se omiten los valores históricos intactos.
export function validarCamposPreventivos(datos, reglas) {
    const errores = {};
    for (const [campo, valor] of Object.entries(datos)) {
        const regla = reglas[campo];
        if (!regla) continue;
        const texto = String(valor ?? '').trim();
        let error;
        if (regla.requerido && (!texto || valor === 0)) error = 'Este campo es obligatorio.';
        else if (regla.max && [...texto].length > regla.max) error = `Ingresá hasta ${regla.max} caracteres.`;
        else if (texto && regla.tipo === 'email') {
            const arroba = texto.lastIndexOf('@');
            const usuario = texto.slice(0, arroba), dominio = texto.slice(arroba + 1);
            const usuarioValido = /^(?:[-!#$%&'*+/=?^_`{}|~0-9a-z]+(?:\.[-!#$%&'*+/=?^_`{}|~0-9a-z]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f!#-\[\]-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")$/i.test(usuario);
            const dominioValido = dominio === 'localhost' || new RegExp(`^${DOMINIO}$`, 'i').test(dominio) ||
                (dominio.startsWith('[') && dominio.endsWith(']') && ipValida(dominio.slice(1, -1)));
            if (arroba < 1 || !usuarioValido || !dominioValido) {
                error = 'Ingresá un correo válido, por ejemplo nombre@dominio.com.';
            }
        } else if (texto && regla.tipo === 'url') {
            const patron = new RegExp(`^(?:https?|ftps?)://(?:[^\\s:@/]+(?::[^\\s:@/]*)?@)?(${IPV4}|\\[[0-9a-f:.]+\\]|${DOMINIO}\\.?|localhost)(?::[0-9]{1,5})?(?:[/?#][^\\s]*)?$`, 'i');
            const partes = texto.match(patron);
            if (!partes || partes[1].length > 253 || (partes[1].startsWith('[') && !ipValida(partes[1].slice(1, -1)))) {
                error = 'Ingresá una URL válida, por ejemplo https://www.dominio.com.';
            }
        } else if (texto && ['fecha', 'nacimiento'].includes(regla.tipo)) {
            const fecha = new Date(`${texto}T00:00:00Z`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || texto.startsWith('0000') ||
                Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== texto) {
                error = 'Ingresá una fecha válida.';
            } else if (regla.tipo === 'nacimiento') {
                const partes = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Argentina/Buenos_Aires', calendar: 'gregory',
                    numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
                }).formatToParts(new Date());
                const valor = tipo => partes.find(parte => parte.type === tipo).value;
                const hoyEduGes = `${valor('year')}-${valor('month')}-${valor('day')}`;
                if (texto > hoyEduGes) error = 'La fecha de nacimiento no puede ser futura.';
            }
        }
        if (error) errores[campo] = [error];
    }
    return errores;
}
