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
                <i class="bi bi-exclamation-circle-fill mt-1" aria-hidden="true"></i>
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
        if (abiertoDesde?.isConnected && abiertoDesde.offsetParent !== null) {
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
        notificar(mensajeExito);
        alGuardar?.(resultado);
    } catch (error) {
        mostrarErroresDelFormulario(formulario, contenedorErrores, error);
    } finally {
        botonCargando(boton, false);
    }
}
