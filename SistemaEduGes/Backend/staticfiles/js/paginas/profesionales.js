// ============================================================
// EduGes - Módulo Profesionales (templates/profesionales.html)
// Listado con búsqueda, orden y paginación; ficha en panel lateral.
// El SuperAdministrador puede editar los datos de un profesional desde su ficha.
//
// Endpoint: GET /api/profesionales/ → array con TODOS los profesionales:
//   [{ id_profesional, nombre, apellido, dni, matricula, contacto, mail,
//      especialidad, rol, usuario, estado_profesional }]   (los cuatro últimos son IDs)
// Como viene todo junto, la búsqueda, el orden y la paginación se hacen en el navegador.
//
// El estado de la pantalla (búsqueda, orden, página y ficha abierta) se guarda
// en la URL, así se puede recargar o compartir sin perder el lugar.
// ============================================================

import { guardar, prepararModal } from '../componentes/formularios.js';
import {
    enteroDeUrl,
    guardarEnUrl,
    leerUrl,
    mostrarPaginacion,
    paginar,
    prepararPaginacion,
    textoTotal,
} from '../componentes/listado.js';
import { PERMISO } from '../constantes.js';
import { profesionales } from '../endpoints.js';
import { esAdministrador, obtenerUsuario, tienePermiso } from '../layout.js';
import { coincideBusqueda, compararTexto } from '../texto.js';
import {
    bloqueCargando,
    bloqueVacio,
    demorar,
    enlaceMail,
    enlaceTelefono,
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
    editandoId: null,           // profesional que se está editando (su ficha se reabre al terminar)
};

// ------------------------------------------------------------
// Estado en la URL: /profesionales/?q=gomez&orden=matricula&page=2&ficha=1
// ------------------------------------------------------------
function leerFiltrosDeUrl() {
    const parametros = leerUrl();
    const orden = parametros.get('orden');
    return {
        q: parametros.get('q') ?? '',
        orden: ORDENES.includes(orden) ? orden : 'apellido',
        page: enteroDeUrl(parametros.get('page')) ?? 1,
    };
}

function guardarEstadoEnUrl() {
    const f = estado.filtros;
    guardarEnUrl({
        q: f.q,
        orden: f.orden !== 'apellido' ? f.orden : null,
        page: f.page > 1 ? f.page : null,
        ficha: estado.fichaId,
    });
}

// ------------------------------------------------------------
// Búsqueda y orden (en el navegador)
// ------------------------------------------------------------
// "maria gom" encuentra a "María Gómez"; "gomez" encuentra a "Gómez"
const coincide = (p, q) => coincideBusqueda([p.nombre, p.apellido, p.dni, p.matricula], q);

const CRITERIOS = {
    apellido: (a, b) => compararTexto(a.apellido, b.apellido) || compararTexto(a.nombre, b.nombre),
    nombre: (a, b) => compararTexto(a.nombre, b.nombre) || compararTexto(a.apellido, b.apellido),
    matricula: (a, b) => compararTexto(a.matricula, b.matricula),
};

function filtrados() {
    const { q, orden } = estado.filtros;
    const lista = q.trim() ? estado.todos.filter((p) => coincide(p, q)) : [...estado.todos];
    return lista.sort(CRITERIOS[orden]);
}

// ------------------------------------------------------------
// Presentación
// ------------------------------------------------------------
const esUsuarioActual = (p) => estado.usuario.profesional?.id === p.id_profesional;

// La API solo deja editar al SuperAdministrador (el único con usuarios.admin)
const puedeEditar = () => esAdministrador(estado.usuario);

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
                        aria-label="Ver ficha de ${nombreCompleto(p)}">
                    <i class="bi bi-person-lines-fill" aria-hidden="true"></i><span class="d-none d-md-inline ms-1">Ver ficha</span>
                </button>
            </td>
        </tr>`;
}

function mostrarListado() {
    const lista = filtrados();
    const resultado = paginar(lista, estado.filtros.page, TAMANIO_PAGINA);
    estado.filtros.page = resultado.pagina;

    const mensajeVacio = estado.filtros.q.trim()
        ? 'No hay profesionales que coincidan con la búsqueda.'
        : 'Todavía no hay profesionales cargados.';
    renderizar($('profesionales-cuerpo'), resultado.items.length > 0
        ? resultado.items.map(filaProfesional)
        : filaCompleta(COLUMNAS, bloqueVacio(mensajeVacio, 'bi-person-x')));

    $('profesionales-total').textContent = textoTotal(lista.length, estado.todos.length, ['profesional', 'profesionales']);
    mostrarPaginacion($('profesionales-paginacion'), resultado);
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
        ${puedeEditar() && html`
            <div class="d-flex justify-content-end mb-3">
                <button type="button" class="btn btn-sm btn-outline-secondary" data-accion="editar">
                    <i class="bi bi-pencil me-1" aria-hidden="true"></i>Editar datos
                </button>
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
// Editar datos (modal)
// La ficha (panel lateral) se cierra antes de abrir el modal y se vuelve a abrir al
// terminar: con los dos abiertos a la vez, el foco del teclado queda atrapado mal.
// ------------------------------------------------------------
const CAMPOS_EDITABLES = ['nombre', 'apellido', 'dni', 'matricula', 'contacto', 'mail'];
let modalEdicion = null;

function validarEdicion(datos, formulario) {
    const errores = {};
    if (!datos.nombre) {
        errores.nombre = ['Indicá el nombre.'];
    }
    if (!datos.apellido) {
        errores.apellido = ['Indicá el apellido.'];
    }
    if (!datos.dni) {
        errores.dni = ['Indicá el DNI.'];
    } else if (!/^\d{7,8}$/.test(datos.dni)) {
        errores.dni = ['El DNI tiene que tener 7 u 8 números, sin puntos.'];
    }
    if (!datos.matricula) {
        errores.matricula = ['Indicá la matrícula.'];
    }
    if (datos.mail && !formulario.elements.mail.checkValidity()) {
        errores.mail = ['Revisá el mail: falta la @ o el dominio.'];
    }
    return errores;
}

function prepararEdicion() {
    const formulario = $('form-profesional');
    modalEdicion = prepararModal({
        modal: $('modal-profesional'),
        formulario,
        contenedorErrores: $('form-profesional-errores'),
        alAbrir: () => {
            const p = estado.todos.find((prof) => prof.id_profesional === estado.editandoId);
            $('modal-profesional-nombre').textContent = nombreCompleto(p);
            CAMPOS_EDITABLES.forEach((campo) => {
                formulario.elements[campo].value = p[campo] ?? '';
            });
        },
    });

    // Al cerrar (guardando o no) se vuelve a la ficha, ya con los datos actualizados
    $('modal-profesional').addEventListener('hidden.bs.modal', () => {
        const id = estado.editandoId;
        estado.editandoId = null;
        if (id !== null) {
            abrirFicha(id);
        }
    });

    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        const actual = estado.todos.find((prof) => prof.id_profesional === estado.editandoId);
        const datos = Object.fromEntries(CAMPOS_EDITABLES.map((campo) => [campo, formulario.elements[campo].value.trim()]));
        // Solo se envía lo que cambió (vacío = sin dato, para teléfono y mail)
        const cambios = Object.fromEntries(Object.entries(datos)
            .map(([campo, valor]) => [campo, valor === '' && ['contacto', 'mail'].includes(campo) ? null : valor])
            .filter(([campo, valor]) => valor !== (actual[campo] ?? null)));
        const sinCambios = Object.keys(cambios).length === 0;

        guardar({
            formulario,
            contenedorErrores: $('form-profesional-errores'),
            boton: $('btn-guardar-profesional'),
            errores: validarEdicion(datos, formulario),
            enviar: () => (sinCambios ? Promise.resolve(actual) : profesionales.actualizar(actual.id_profesional, cambios)),
            mensajeExito: sinCambios ? 'No había cambios para guardar.' : 'Los datos del profesional se actualizaron.',
            modal: modalEdicion,
            alGuardar: (actualizado) => {
                estado.todos = estado.todos.map((prof) => (prof.id_profesional === actualizado.id_profesional ? actualizado : prof));
                mostrarListado();
            },
        });
    });
}

function abrirEdicion() {
    estado.editandoId = estado.fichaId;
    $('ficha-profesional').addEventListener('hidden.bs.offcanvas', () => modalEdicion().show(), { once: true });
    panelFicha().hide();
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

    prepararPaginacion($('profesionales-paginacion'), (cambio) => {
        estado.filtros.page += cambio;
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

    $('ficha-cuerpo').addEventListener('click', (evento) => {
        if (evento.target.closest('[data-accion="editar"]')) {
            abrirEdicion();
        }
    });

    $('ficha-profesional').addEventListener('hidden.bs.offcanvas', () => {
        const id = estado.fichaId;
        estado.fichaId = null;
        guardarEstadoEnUrl();
        // El panel se abre por código: Bootstrap no devuelve el foco solo.
        // Si se cerró para editar, el foco lo toma el modal.
        if (estado.editandoId === null) {
            document.querySelector(`tr[data-profesional-id="${id}"] [data-accion="ver-ficha"]`)?.focus();
        }
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

    if (puedeEditar()) {
        prepararEdicion();
    }
    if (await cargarListado() && fichaInicial) {
        abrirFicha(fichaInicial);
    }
}

iniciar();
