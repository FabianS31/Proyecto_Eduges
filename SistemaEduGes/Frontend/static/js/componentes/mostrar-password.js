// ============================================================
// EduGes - Botón "Mostrar" en los campos de contraseña
// Ver lo que se escribe evita errores de tipeo, sobre todo en el celular.
//
// Se activa con el atributo data-mostrar-password en el <input type="password">:
//   prepararMostrarPassword(document);
//
// El botón dice con palabras lo que hace ("Mostrar" / "Ocultar"), no es solo un ícono.
// Al enviar o vaciar el formulario, la contraseña vuelve a ocultarse.
// ============================================================

import { html, renderizar } from '../ui.js';

function actualizar(boton, input, visible) {
    input.type = visible ? 'text' : 'password';
    renderizar(boton, visible
        ? html`<i class="bi bi-eye-slash me-1" aria-hidden="true"></i>Ocultar<span class="visually-hidden"> contraseña</span>`
        : html`<i class="bi bi-eye me-1" aria-hidden="true"></i>Mostrar<span class="visually-hidden"> contraseña</span>`);
}

function agregarBoton(input) {
    // El botón va pegado al campo, dentro de un input-group (si no hay uno, se crea)
    let grupo = input.closest('.input-group');
    if (!grupo) {
        grupo = document.createElement('div');
        grupo.className = 'input-group';
        input.replaceWith(grupo);
        grupo.append(input);
    }
    input.style.borderTopRightRadius = '0';
    input.style.borderBottomRightRadius = '0';

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn btn-outline-secondary boton-mostrar-password';
    boton.setAttribute('aria-controls', input.id);
    actualizar(boton, input, false);
    grupo.append(boton);

    boton.addEventListener('click', () => {
        actualizar(boton, input, input.type === 'password');
        input.focus();
    });

    const ocultar = () => actualizar(boton, input, false);
    input.form?.addEventListener('submit', ocultar);
    input.form?.addEventListener('reset', ocultar);
}

export function prepararMostrarPassword(raiz = document) {
    raiz.querySelectorAll('input[type="password"][data-mostrar-password]').forEach(agregarBoton);
}
