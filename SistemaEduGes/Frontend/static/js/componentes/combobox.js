// ============================================================
// EduGes - Campo con sugerencias (combobox accesible)
// Reemplaza a las listas desplegables: se escribe y aparecen sugerencias.
// Sigue el patrón "combobox" de ARIA 1.2 (lista emergente con aria-activedescendant):
//
//   ↓ / ↑      abren la lista y recorren las sugerencias
//   Enter      elige la sugerencia marcada
//   Escape     cierra la lista (si ya está cerrada, borra lo escrito)
//   Tab        sale del campo (la lista se cierra)
//
// Uso:
//   const paciente = crearCombobox(document.getElementById('turno-paciente'), {
//       buscar: async (texto, signal) => [{ valor: 5, texto: 'Pérez, Lucas', detalle: 'DNI 50111222' }],
//       alElegir: (opcion) => { ... },
//   });
//   paciente.valor();   // 5, o null si no se eligió nada de la lista
//
// El valor elegido se guarda en input.dataset.valor. Si se escribe algo que no
// está en la lista, el valor queda vacío (salvo con textoLibre).
// ============================================================

import { demorar, html, mensajeDeError, renderizar } from '../ui.js';

let contador = 0;

// "Gómez" y "gomez" coinciden
export function normalizarTexto(texto) {
    return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Arma un buscar() para una lista fija de opciones: coincide si cada palabra escrita
// aparece en el texto o el detalle de la opción
export function buscarEnLista(opciones) {
    return async (texto) => {
        const palabras = normalizarTexto(texto).split(/\s+/).filter(Boolean);
        return opciones.filter((opcion) => {
            const donde = normalizarTexto(`${opcion.texto} ${opcion.detalle ?? ''}`);
            return palabras.every((palabra) => donde.includes(palabra));
        });
    };
}

/**
 * @param {HTMLInputElement} input
 * @param {object} opciones
 * @param {(texto: string, signal: AbortSignal) => Promise<Array<{valor, texto, detalle?}>>} opciones.buscar
 * @param {(opcion: object|null) => void} [opciones.alElegir]   se llama al elegir (o al borrar la elección, con null)
 * @param {string} [opciones.mensajeVacio]                       qué decir si no hay sugerencias
 * @param {number} [opciones.minimo]                             letras para empezar a sugerir (0 = al entrar al campo)
 * @param {boolean} [opciones.textoLibre]                        acepta lo escrito aunque no esté en la lista
 * @param {number} [opciones.maximo]                             cantidad máxima de sugerencias a mostrar
 */
export function crearCombobox(input, {
    buscar,
    alElegir = () => {},
    mensajeVacio = 'No hay coincidencias.',
    minimo = 0,
    textoLibre = false,
    maximo = 8,
} = {}) {
    const id = input.id || `combobox-${++contador}`;
    input.id = id;

    const contenedor = document.createElement('div');
    contenedor.className = 'combobox';
    input.replaceWith(contenedor);
    contenedor.append(input);

    const lista = document.createElement('ul');
    lista.id = `${id}-lista`;
    lista.className = 'combobox-lista list-group shadow-sm';
    lista.setAttribute('role', 'listbox');
    lista.hidden = true;
    const etiqueta = document.querySelector(`label[for="${id}"]`);
    if (etiqueta) {
        etiqueta.id ||= `${id}-etiqueta`;
        lista.setAttribute('aria-labelledby', etiqueta.id);
    }

    // Anuncia cuántas sugerencias hay, sin mover el foco del campo
    const anuncio = document.createElement('div');
    anuncio.className = 'visually-hidden';
    anuncio.setAttribute('aria-live', 'polite');
    contenedor.append(lista, anuncio);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', lista.id);
    input.setAttribute('autocomplete', 'off');

    let opciones = [];
    let activa = -1;
    let elegida = null;
    let controlador = null;

    function marcarActiva(indice) {
        activa = indice;
        lista.querySelectorAll('[role="option"]').forEach((nodo, i) => {
            const esActiva = i === indice;
            nodo.classList.toggle('activa', esActiva);
            nodo.setAttribute('aria-selected', esActiva ? 'true' : 'false');
            if (esActiva) {
                nodo.scrollIntoView({ block: 'nearest' });
            }
        });
        if (indice >= 0) {
            input.setAttribute('aria-activedescendant', `${lista.id}-${indice}`);
        } else {
            input.removeAttribute('aria-activedescendant');
        }
    }

    function abrir() {
        lista.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    function cerrar() {
        controlador?.abort();
        lista.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        marcarActiva(-1);
    }

    function mostrar(contenido, mensaje) {
        renderizar(lista, contenido);
        anuncio.textContent = mensaje;
        abrir();
    }

    function mostrarOpciones(resultado) {
        opciones = resultado.slice(0, maximo);
        activa = -1;
        if (opciones.length === 0) {
            mostrar(html`<li class="list-group-item small text-muted combobox-mensaje" role="presentation">${mensajeVacio}</li>`, mensajeVacio);
            return;
        }
        mostrar(opciones.map((opcion, i) => html`
            <li class="list-group-item list-group-item-action combobox-opcion" role="option" id="${lista.id}-${i}"
                data-indice="${i}" aria-selected="false">
                <span class="fw-semibold">${opcion.texto}</span>
                ${opcion.detalle && html`<span class="combobox-detalle small d-block">${opcion.detalle}</span>`}
            </li>`),
        opciones.length === 1 ? '1 sugerencia. Usá las flechas para elegir.' : `${opciones.length} sugerencias. Usá las flechas para elegir.`);
    }

    async function sugerir() {
        const texto = input.value;
        if (normalizarTexto(texto).length < minimo) {
            cerrar();
            return;
        }
        controlador?.abort();
        controlador = new AbortController();
        const { signal } = controlador;
        try {
            const resultado = await buscar(texto, signal);
            if (!signal.aborted && document.activeElement === input) {
                mostrarOpciones(resultado);
            }
        } catch (error) {
            const mensaje = mensajeDeError(error);
            if (mensaje !== null && !signal.aborted) {
                mostrar(html`<li class="list-group-item small text-danger combobox-mensaje" role="presentation">${mensaje}</li>`, mensaje);
            }
        }
    }
    const sugerirDemorado = demorar(sugerir, 200);

    function elegir(opcion) {
        elegida = opcion;
        input.value = opcion ? opcion.texto : '';
        input.dataset.valor = opcion ? String(opcion.valor) : '';
        input.classList.remove('is-invalid');
        cerrar();
        alElegir(opcion);
    }

    input.addEventListener('input', () => {
        // Al escribir se pierde la elección anterior: hay que volver a elegir de la lista
        if (elegida) {
            elegida = null;
            input.dataset.valor = '';
            alElegir(null);
        }
        sugerirDemorado();
    });

    input.addEventListener('focus', () => {
        if (minimo === 0 && !elegida) {
            sugerir();
        }
    });

    input.addEventListener('keydown', (evento) => {
        const abierta = !lista.hidden && opciones.length > 0;
        switch (evento.key) {
        case 'ArrowDown':
            evento.preventDefault();
            if (!abierta) {
                sugerir().then(() => opciones.length > 0 && marcarActiva(0));
            } else {
                marcarActiva((activa + 1) % opciones.length);
            }
            break;
        case 'ArrowUp':
            if (abierta) {
                evento.preventDefault();
                marcarActiva(activa <= 0 ? opciones.length - 1 : activa - 1);
            }
            break;
        case 'Enter':
            if (abierta && activa >= 0) {
                evento.preventDefault();   // no envía el formulario: solo elige
                elegir(opciones[activa]);
            }
            break;
        case 'Escape':
            if (!lista.hidden) {
                evento.preventDefault();
                evento.stopPropagation();  // no cierra el modal que contiene al campo
                cerrar();
            } else if (input.value) {
                evento.preventDefault();
                evento.stopPropagation();
                elegir(null);
            }
            break;
        case 'Tab':
            cerrar();
            break;
        default:
            break;
        }
    });

    // mousedown en vez de click: así el campo no pierde el foco antes de elegir
    lista.addEventListener('mousedown', (evento) => {
        const nodo = evento.target.closest('[role="option"]');
        evento.preventDefault();
        if (nodo) {
            elegir(opciones[Number(nodo.dataset.indice)]);
        }
    });

    input.addEventListener('blur', () => {
        cerrar();
        if (!elegida && !textoLibre) {
            input.dataset.valor = '';
        }
    });

    return {
        // Valor de la opción elegida; con textoLibre, lo escrito si no se eligió nada
        valor() {
            if (elegida) {
                return elegida.valor;
            }
            return textoLibre && input.value.trim() ? input.value.trim() : null;
        },
        elegir,
        limpiar() {
            elegida = null;
            input.value = '';
            input.dataset.valor = '';
            cerrar();
        },
    };
}
