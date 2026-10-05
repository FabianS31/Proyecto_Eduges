// ============================================================
// EduGes - Módulo Profesionales (templates/profesionales.html)
// Listado con búsqueda, orden y paginación; ficha en panel lateral. Solo lectura.
//
// Endpoint: GET /api/profesionales/ → array con TODOS los profesionales:
//   [{ id_profesional, nombre, apellido, dni, matricula, contacto, mail,
//      especialidad, rol, usuario, estado_profesional }]   (los cuatro últimos son IDs)
// Como viene todo junto, la búsqueda, el orden y la paginación se hacen en el navegador.
//
// El estado de la pantalla (búsqueda, orden, página y ficha abierta) se guarda
// en la URL, así se puede recargar o compartir sin perder el lugar.
// ============================================================

import { PERMISO } from '../constantes.js';
import { profesionales } from '../endpoints.js';
import { obtenerUsuario, tienePermiso } from '../layout.js';
import {
    bloqueCargando,
    bloqueVacio,
    demorar,
    filaCompleta,
    html,
    mostrarError,
    nombreCompleto,
    renderizar,
} from '../ui.js';

const COLUMNAS = 4;
const TAMANIO_PAGINA = 10;
const ORDENES = ['apellido', 'nombre', 'matricula'];

const $ = (id) => document.getElementById(id);

const estado = {
    usuario: null,
    todos: [],                  // lo que devolvió la API
    filtros: leerFiltrosDeUrl(),
    fichaId: null,              // profesional con la ficha abierta
};

// ------------------------------------------------------------
// Estado en la URL: /profesionales/?q=gomez&orden=matricula&page=2&ficha=1
// ------------------------------------------------------------
function enteroDeUrl(valor) {
    return /^\d+$/.test(valor ?? '') ? Number(valor) : null;
}

function leerFiltrosDeUrl() {
    const parametros = new URLSearchParams(window.location.search);
    const orden = parametros.get('orden');
    return {
        q: parametros.get('q') ?? '',
        orden: ORDENES.includes(orden) ? orden : 'apellido',
        page: enteroDeUrl(parametros.get('page')) ?? 1,
    };
}

function guardarEstadoEnUrl() {
    const url = new URL(window.location.href);
    const f = estado.filtros;
    const valores = {
        q: f.q,
        orden: f.orden !== 'apellido' ? f.orden : null,
        page: f.page > 1 ? f.page : null,
        ficha: estado.fichaId,
    };
    for (const [clave, valor] of Object.entries(valores)) {
        if (valor === null || valor === '') {
            url.searchParams.delete(clave);
        } else {
            url.searchParams.set(clave, valor);
        }
    }
    window.history.replaceState(null, '', url);
}

// ------------------------------------------------------------
// Búsqueda y orden (en el navegador)
// ------------------------------------------------------------
// Sin acentos y en minúsculas: "gomez" encuentra a "Gómez"
function normalizar(texto) {
    return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function coincide(p, q) {
    const texto = normalizar([p.nombre, p.apellido, p.dni, p.matricula].join(' '));
    // Cada palabra buscada tiene que aparecer: "maria gom" encuentra a "María Gómez"
    return normalizar(q).split(/\s+/).every((palabra) => texto.includes(palabra));
}

const comparar = (a, b) => normalizar(a).localeCompare(normalizar(b), 'es', { numeric: true });

const CRITERIOS = {
    apellido: (a, b) => comparar(a.apellido, b.apellido) || comparar(a.nombre, b.nombre),
    nombre: (a, b) => comparar(a.nombre, b.nombre) || comparar(a.apellido, b.apellido),
    matricula: (a, b) => comparar(a.matricula, b.matricula),
};

function filtrados() {
    const { q, orden } = estado.filtros;
    const lista = q.trim() ? estado.todos.filter((p) => coincide(p, q)) : [...estado.todos];
    return lista.sort(CRITERIOS[orden]);
}

// ------------------------------------------------------------
// Presentación
// ------------------------------------------------------------
function enlaceTelefono(telefono) {
    if (!telefono) {
        return html`<span class="text-muted">—</span>`;
    }
    return html`<a href="tel:${telefono.replace(/[^\d+]/g, '')}" class="link-secondary">${telefono}</a>`;
}

function enlaceMail(mail) {
    if (!mail) {
        return html`<span class="text-muted">—</span>`;
    }
    return html`<a href="mailto:${mail}" class="link-secondary text-break">${mail}</a>`;
}

const esUsuarioActual = (p) => estado.usuario.profesional?.id === p.id_profesional;

function filaProfesional(p) {
    return html`
        <tr data-profesional-id="${p.id_profesional}">
            <td>
                <div class="fw-semibold text-dark">
                    ${nombreCompleto(p, { apellidoPrimero: true })}
                    ${esUsuarioActual(p) && html`<span class="badge rounded-pill bg-primary-subtle text-primary-emphasis ms-1">Vos</span>`}
                </div>
                <div class="text-muted small">Mat. ${p.matricula}</div>
            </td>
            <td class="d-none d-md-table-cell">${p.dni}</td>
            <td class="d-none d-lg-table-cell">
                ${p.contacto || p.mail
                    ? html`
                        ${p.contacto && html`<div><i class="bi bi-telephone me-1 text-secondary" aria-hidden="true"></i>${enlaceTelefono(p.contacto)}</div>`}
                        ${p.mail && html`<div><i class="bi bi-envelope me-1 text-secondary" aria-hidden="true"></i>${enlaceMail(p.mail)}</div>`}`
                    : html`<span class="text-muted">—</span>`}
            </td>
            <td class="text-end">
                <button type="button" class="btn btn-sm btn-light border text-primary" data-accion="ver-ficha"
                        title="Ver ficha" aria-label="Ver ficha de ${nombreCompleto(p)}">
                    <i class="bi bi-person-lines-fill" aria-hidden="true"></i>
                </button>
            </td>
        </tr>`;
}

function mostrarPaginacion(total, desde, hasta, paginas) {
    const nav = $('profesionales-paginacion');
    nav.classList.toggle('d-none', paginas <= 1);
    if (paginas <= 1) {
        return;
    }
    $('paginacion-texto').textContent = `Mostrando ${desde}–${hasta} de ${total}`;
    $('btn-pagina-anterior').disabled = estado.filtros.page <= 1;
    $('btn-pagina-siguiente').disabled = estado.filtros.page >= paginas;
}

function mostrarListado() {
    const lista = filtrados();
    const paginas = Math.max(1, Math.ceil(lista.length / TAMANIO_PAGINA));
    // Página fuera de rango (ej.: URL vieja o la búsqueda achicó el resultado): se va a la última
    estado.filtros.page = Math.min(Math.max(1, estado.filtros.page), paginas);
    const inicio = (estado.filtros.page - 1) * TAMANIO_PAGINA;
    const pagina = lista.slice(inicio, inicio + TAMANIO_PAGINA);

    const mensajeVacio = estado.filtros.q.trim()
        ? 'No hay profesionales que coincidan con la búsqueda.'
        : 'Todavía no hay profesionales cargados.';
    renderizar($('profesionales-cuerpo'), pagina.length > 0
        ? pagina.map(filaProfesional)
        : filaCompleta(COLUMNAS, bloqueVacio(mensajeVacio, 'bi-person-x')));

    const total = estado.todos.length;
    $('profesionales-total').textContent = lista.length === total
        ? (total === 1 ? '1 profesional' : `${total} profesionales`)
        : `${lista.length} de ${total}`;
    mostrarPaginacion(lista.length, inicio + 1, inicio + pagina.length, paginas);
    guardarEstadoEnUrl();
}

async function cargarListado() {
    renderizar($('profesionales-cuerpo'), filaCompleta(COLUMNAS, bloqueCargando(3)));
    try {
        estado.todos = await profesionales.listar();
        mostrarListado();
        return true;
    } catch (error) {
        $('profesionales-total').textContent = '';
        $('profesionales-paginacion').classList.add('d-none');
        mostrarError($('profesionales-cuerpo'), error, () => cargarListado(), { colspan: COLUMNAS });
        return false;
    }
}

// ------------------------------------------------------------
// Ficha (con los datos del listado: la API no tiene detalle aparte)
// ------------------------------------------------------------
const panelFicha = () => window.bootstrap.Offcanvas.getOrCreateInstance($('ficha-profesional'));

function abrirFicha(id) {
    const p = estado.todos.find((prof) => prof.id_profesional === id);
    estado.fichaId = p ? id : null;
    guardarEstadoEnUrl();

    if (!p) {
        $('ficha-titulo').textContent = 'Ficha del profesional';
        $('ficha-subtitulo').textContent = '';
        renderizar($('ficha-cuerpo'), bloqueVacio('No se encontró este profesional.', 'bi-person-x'));
        panelFicha().show();
        return;
    }

    // La especialidad solo viene con nombre en /me: se conoce únicamente la del usuario actual
    const especialidad = esUsuarioActual(p) ? estado.usuario.profesional.especialidad?.nombre : null;
    $('ficha-titulo').textContent = nombreCompleto(p);
    $('ficha-subtitulo').textContent = especialidad ?? `Matrícula ${p.matricula}`;

    renderizar($('ficha-cuerpo'), html`
        ${esUsuarioActual(p) && html`
            <div class="alert alert-primary py-2 small mb-3">
                <i class="bi bi-person-check me-1" aria-hidden="true"></i>Este es tu perfil.
            </div>`}
        <dl class="ficha-dato row g-0 mb-0">
            <div class="col-6"><dt>Matrícula</dt><dd>${p.matricula}</dd></div>
            <div class="col-6"><dt>DNI</dt><dd>${p.dni}</dd></div>
            <div class="col-12"><dt>Teléfono</dt><dd>${enlaceTelefono(p.contacto)}</dd></div>
            <div class="col-12"><dt>Mail</dt><dd>${enlaceMail(p.mail)}</dd></div>
        </dl>`);
    panelFicha().show();
}

// ------------------------------------------------------------
// Eventos
// ------------------------------------------------------------
function cambiarFiltros(cambios) {
    Object.assign(estado.filtros, cambios, { page: 1 });
    mostrarListado();
}

function prepararEventos() {
    const formulario = $('filtros-profesionales');
    const busqueda = $('filtro-q');
    const orden = $('filtro-orden');
    busqueda.value = estado.filtros.q;
    orden.value = estado.filtros.orden;

    const buscar = demorar(() => cambiarFiltros({ q: busqueda.value }), 200);
    busqueda.addEventListener('input', buscar);
    orden.addEventListener('change', () => cambiarFiltros({ orden: orden.value }));
    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        cambiarFiltros({ q: busqueda.value });
    });
    formulario.addEventListener('reset', () => {
        // El reset del navegador vacía los campos después de este evento
        setTimeout(() => cambiarFiltros({ q: '', orden: 'apellido' }));
    });

    $('btn-pagina-anterior').addEventListener('click', () => {
        estado.filtros.page -= 1;
        mostrarListado();
    });
    $('btn-pagina-siguiente').addEventListener('click', () => {
        estado.filtros.page += 1;
        mostrarListado();
    });

    $('profesionales-cuerpo').addEventListener('click', (evento) => {
        // Los links de teléfono y mail funcionan normal; el resto de la fila abre la ficha
        if (evento.target.closest('a')) {
            return;
        }
        const fila = evento.target.closest('tr[data-profesional-id]');
        if (fila) {
            abrirFicha(Number(fila.dataset.profesionalId));
        }
    });

    $('ficha-profesional').addEventListener('hidden.bs.offcanvas', () => {
        const id = estado.fichaId;
        estado.fichaId = null;
        guardarEstadoEnUrl();
        // El panel se abre por código: Bootstrap no devuelve el foco solo
        document.querySelector(`tr[data-profesional-id="${id}"] [data-accion="ver-ficha"]`)?.focus();
    });
}

// ------------------------------------------------------------
// Inicio
// ------------------------------------------------------------
async function iniciar() {
    // Se lee antes de cargar el listado, que reescribe la URL
    const fichaInicial = enteroDeUrl(new URLSearchParams(window.location.search).get('ficha'));
    prepararEventos();

    try {
        estado.usuario = await obtenerUsuario();
    } catch (error) {
        // 401: api.js ya redirige al login
        if (error.status !== 401) {
            mostrarError($('profesionales-cuerpo'), error, () => window.location.reload(), { colspan: COLUMNAS });
        }
        return;
    }

    if (!tienePermiso(estado.usuario, PERMISO.PROFESIONALES_VER)) {
        renderizar($('profesionales-cuerpo'),
            filaCompleta(COLUMNAS, bloqueVacio('No tenés acceso al listado de profesionales.', 'bi-lock')));
        return;
    }

    if (await cargarListado() && fichaInicial) {
        abrirFicha(fichaInicial);
    }
}

iniciar();
