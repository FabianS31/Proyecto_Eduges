// ============================================================
// EduGes - Módulo Profesionales (templates/profesionales.html)
// Listado con búsqueda, filtros y paginación; ficha en panel lateral;
// alta, edición, cambio de estado y asignación de pacientes (solo Administrador).
// Endpoints: docs/api-contrato.md §4 (catálogos), §6 (pacientes) y §8.
//
// El estado de la pantalla (búsqueda, filtros, página y ficha abierta) se
// guarda en la URL, así se puede recargar o compartir sin perder el lugar.
// ============================================================

import { ApiError } from '../api.js';
import { ESTADO_PACIENTE, PERMISO, ROL } from '../constantes.js';
import { asignaciones, catalogos, pacientes, profesionales } from '../endpoints.js';
import { hoyISO } from '../fechas.js';
import { obtenerUsuario, tienePermiso } from '../layout.js';
import {
    bloqueCargando,
    bloqueVacio,
    botonCargando,
    confirmar,
    demorar,
    filaCompleta,
    formatearFecha,
    html,
    limpiarErroresFormulario,
    mensajeDeError,
    mostrarError,
    mostrarErroresFormulario,
    nombreCompleto,
    notificar,
    notificarError,
    renderizar,
} from '../ui.js';

const COLUMNAS = 6;
const TAMANIO_PAGINA = 20;
const RESULTADOS_BUSCADOR = 6;

const $ = (id) => document.getElementById(id);

const estado = {
    usuario: null,
    catalogos: null,
    filtros: leerFiltrosDeUrl(),
    controlador: null,          // AbortController del listado
    profesionales: new Map(),   // profesionales de la página mostrada, por id
    ficha: {
        id: null,               // profesional con la ficha abierta
        controlador: null,
        profesional: null,      // datos cargados de la ficha
        asignaciones: null,     // array, o null si el usuario no las puede ver
        pacienteElegido: null,  // paciente seleccionado en "Asignar paciente"
        resultadosPacientes: new Map(), // resultados del buscador, por id
        buscador: null,         // AbortController del buscador de pacientes
    },
    formulario: {
        modo: 'crear',          // 'crear' | 'editar'
        id: null,
        focoAnterior: null,
    },
};

// ------------------------------------------------------------
// Estado en la URL: /profesionales/?q=soto&especialidad=1&estado=1&page=2&ficha=5
// ------------------------------------------------------------
function enteroDeUrl(valor) {
    return /^\d+$/.test(valor ?? '') ? Number(valor) : null;
}

function leerFiltrosDeUrl() {
    const parametros = new URLSearchParams(window.location.search);
    return {
        q: parametros.get('q') ?? '',
        especialidad: enteroDeUrl(parametros.get('especialidad')),
        estado: enteroDeUrl(parametros.get('estado')),
        page: enteroDeUrl(parametros.get('page')) ?? 1,
        page_size: enteroDeUrl(parametros.get('page_size')),
    };
}

function guardarEstadoEnUrl() {
    const url = new URL(window.location.href);
    const f = estado.filtros;
    const valores = {
        q: f.q,
        especialidad: f.especialidad,
        estado: f.estado,
        page: f.page > 1 ? f.page : null,
        page_size: f.page_size,
        ficha: estado.ficha.id,
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

const hayFiltros = () => Boolean(estado.filtros.q || estado.filtros.especialidad || estado.filtros.estado);

const esAdmin = () => estado.usuario.rol.id === ROL.ADMINISTRADOR;

const puedeEditar = () => tienePermiso(estado.usuario, PERMISO.PROFESIONALES_EDITAR);

// ------------------------------------------------------------
// Presentación
// ------------------------------------------------------------
function normalizar(texto) {
    return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Los IDs de estados_profesionales no están fijados en el contrato: se reconocen por el nombre
const esEstado = (estadoProfesional, nombre) => normalizar(estadoProfesional?.nombre) === nombre;

function badgeEstadoProfesional(estadoProfesional) {
    let clase = 'bg-secondary-subtle text-secondary-emphasis';
    if (esEstado(estadoProfesional, 'activo')) {
        clase = 'bg-success-subtle text-success-emphasis';
    } else if (esEstado(estadoProfesional, 'licencia')) {
        clase = 'bg-warning-subtle text-warning-emphasis';
    }
    return html`<span class="badge rounded-pill ${clase}">${estadoProfesional?.nombre ?? 'Sin estado'}</span>`;
}

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

function textoPacientes(cantidad) {
    return cantidad === 1 ? '1 paciente asignado' : `${cantidad} pacientes asignados`;
}

// ------------------------------------------------------------
// Listado
// ------------------------------------------------------------
function filaProfesional(p) {
    const nombre = nombreCompleto(p);
    return html`
        <tr data-profesional-id="${p.id}">
            <td>
                <div class="fw-semibold text-dark">${nombreCompleto(p, { apellidoPrimero: true })}</div>
                <div class="text-muted small">
                    Mat. ${p.matricula}<span class="d-md-none"> · ${p.especialidad?.nombre ?? ''}</span>
                </div>
            </td>
            <td class="d-none d-md-table-cell">${p.especialidad?.nombre ?? '—'}</td>
            <td class="d-none d-lg-table-cell">
                ${p.contacto || p.mail
                    ? html`
                        ${p.contacto && html`<div><i class="bi bi-telephone me-1 text-secondary" aria-hidden="true"></i>${enlaceTelefono(p.contacto)}</div>`}
                        ${p.mail && html`<div><i class="bi bi-envelope me-1 text-secondary" aria-hidden="true"></i>${enlaceMail(p.mail)}</div>`}`
                    : html`<span class="text-muted">—</span>`}
            </td>
            <td>${badgeEstadoProfesional(p.estado)}</td>
            <td class="text-center d-none d-sm-table-cell fw-semibold" title="${textoPacientes(p.pacientes_asignados)}">${p.pacientes_asignados}</td>
            <td class="text-end">
                <button type="button" class="btn btn-sm btn-light border text-primary" data-accion="ver-ficha"
                        title="Ver ficha" aria-label="Ver ficha de ${nombre}">
                    <i class="bi bi-person-lines-fill" aria-hidden="true"></i>
                </button>
            </td>
        </tr>`;
}

function mostrarPaginacion(pagina) {
    const nav = $('profesionales-paginacion');
    const hayVariasPaginas = Boolean(pagina.next || pagina.previous);
    nav.classList.toggle('d-none', !hayVariasPaginas);
    if (!hayVariasPaginas) {
        return;
    }
    const tamanio = estado.filtros.page_size ?? TAMANIO_PAGINA;
    const desde = (estado.filtros.page - 1) * tamanio + 1;
    const hasta = desde + pagina.results.length - 1;
    $('paginacion-texto').textContent = `Mostrando ${desde}–${hasta} de ${pagina.count}`;
    $('btn-pagina-anterior').disabled = !pagina.previous;
    $('btn-pagina-siguiente').disabled = !pagina.next;
}

// silencioso: actualiza sin mostrar el estado de carga (después de guardar un cambio)
async function cargarListado({ silencioso = false } = {}) {
    estado.controlador?.abort();
    estado.controlador = new AbortController();
    const { signal } = estado.controlador;
    const f = estado.filtros;
    const cuerpo = $('profesionales-cuerpo');

    guardarEstadoEnUrl();
    if (!silencioso) {
        renderizar(cuerpo, filaCompleta(COLUMNAS, bloqueCargando(3)));
    }

    try {
        const pagina = await profesionales.listar({
            q: f.q,
            especialidad: f.especialidad,
            estado: f.estado,
            page: f.page,
            page_size: f.page_size,
        }, { signal });

        estado.profesionales = new Map(pagina.results.map((p) => [p.id, p]));
        const mensajeVacio = hayFiltros()
            ? 'No hay profesionales que coincidan con la búsqueda.'
            : 'Todavía no hay profesionales cargados.';
        renderizar(cuerpo, pagina.results.length > 0
            ? pagina.results.map(filaProfesional)
            : filaCompleta(COLUMNAS, bloqueVacio(mensajeVacio, 'bi-person-x')));
        $('profesionales-total').textContent = pagina.count === 1 ? '1 profesional' : `${pagina.count} profesionales`;
        mostrarPaginacion(pagina);
    } catch (error) {
        if (error.name === 'AbortError') {
            return;
        }
        // La página pedida ya no existe (ej.: URL vieja o cambió la cantidad): se vuelve a la primera
        if (error.status === 404 && f.page > 1) {
            f.page = 1;
            cargarListado();
            return;
        }
        $('profesionales-total').textContent = '';
        $('profesionales-paginacion').classList.add('d-none');
        mostrarError(cuerpo, error, () => cargarListado(), { colspan: COLUMNAS });
    }
}

// ------------------------------------------------------------
// Filtros
// ------------------------------------------------------------
function opcionesCatalogo(select, items) {
    const primera = select.options[0];
    renderizar(select, [
        html`<option value="">${primera.textContent}</option>`,
        ...items.map((item) => html`<option value="${item.id}">${item.nombre}</option>`),
    ]);
}

async function cargarCatalogos() {
    try {
        estado.catalogos = await catalogos.obtener();
        opcionesCatalogo($('filtro-especialidad'), estado.catalogos.especialidades);
        opcionesCatalogo($('filtro-estado'), estado.catalogos.estados_profesionales);
        opcionesCatalogo($('prof-especialidad'), estado.catalogos.especialidades);
        $('filtro-especialidad').value = estado.filtros.especialidad ?? '';
        $('filtro-estado').value = estado.filtros.estado ?? '';
    } catch (error) {
        // Sin catálogos se puede seguir buscando por texto; se avisa y listo
        notificarError(error);
    }
}

function aplicarFiltros(cambios) {
    Object.assign(estado.filtros, cambios, { page: 1 });
    cargarListado();
}

function prepararFiltros() {
    const formulario = $('filtros-profesionales');
    const busqueda = $('filtro-q');
    busqueda.value = estado.filtros.q;

    const buscar = demorar(() => {
        const q = busqueda.value.trim();
        if (q !== estado.filtros.q) {
            aplicarFiltros({ q });
        }
    }, 300);
    busqueda.addEventListener('input', buscar);

    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        aplicarFiltros({ q: busqueda.value.trim() });
    });

    $('filtro-especialidad').addEventListener('change', (e) =>
        aplicarFiltros({ especialidad: enteroDeUrl(e.target.value) }));
    $('filtro-estado').addEventListener('change', (e) =>
        aplicarFiltros({ estado: enteroDeUrl(e.target.value) }));

    // "Limpiar" es un reset del formulario: se espera a que el navegador vacíe los campos
    formulario.addEventListener('reset', () => {
        setTimeout(() => aplicarFiltros({ q: '', especialidad: null, estado: null }), 0);
    });

    $('btn-pagina-anterior').addEventListener('click', () => {
        estado.filtros.page -= 1;
        cargarListado();
    });
    $('btn-pagina-siguiente').addEventListener('click', () => {
        estado.filtros.page += 1;
        cargarListado();
    });
}

// ------------------------------------------------------------
// Ficha (panel lateral)
// ------------------------------------------------------------
const panelFicha = () => window.bootstrap.Offcanvas.getOrCreateInstance($('ficha-profesional'));

function itemAsignacion(asignacion, { conAcciones }) {
    let periodo = `${formatearFecha(asignacion.fecha_inicio)} – ${formatearFecha(asignacion.fecha_fin)}`;
    if (asignacion.vigente) {
        // Vigente con fecha de fin: termina ese día (inclusive)
        periodo = asignacion.fecha_fin
            ? `Hasta ${formatearFecha(asignacion.fecha_fin)}`
            : `Desde ${formatearFecha(asignacion.fecha_inicio)}`;
    }
    const nombre = nombreCompleto(asignacion.paciente, { apellidoPrimero: true });
    const puedeFinalizar = conAcciones && asignacion.vigente && !asignacion.fecha_fin;
    return html`
        <li class="ficha-asignacion p-2 d-flex justify-content-between align-items-center gap-2" data-asignacion-id="${asignacion.id}">
            <span class="fw-semibold small">${nombre}</span>
            <span class="d-flex align-items-center gap-2">
                <span class="small text-muted text-nowrap">${periodo}</span>
                ${puedeFinalizar && html`
                    <button type="button" class="btn btn-sm btn-light border text-danger py-0" data-accion="finalizar"
                            title="Finalizar asignación" aria-label="Finalizar la asignación de ${nombre}">
                        <i class="bi bi-person-dash" aria-hidden="true"></i>
                    </button>`}
            </span>
        </li>`;
}

function formularioAsignar() {
    return html`
        <form class="border rounded p-3 mb-3 bg-light" id="form-asignar" novalidate>
            <label for="asignar-buscar" class="form-label small fw-semibold">Paciente</label>
            <input type="search" class="form-control form-control-sm" id="asignar-buscar" name="paciente_id"
                   placeholder="Buscar por nombre, apellido o DNI" autocomplete="off" aria-describedby="asignar-ayuda">
            <div class="form-text" id="asignar-ayuda">Solo pacientes activos.</div>
            <div class="list-group list-group-flush asignar-resultados mt-2" id="asignar-resultados" aria-live="polite"></div>

            <label for="asignar-fecha" class="form-label small fw-semibold mt-3">Fecha de inicio</label>
            <input type="date" class="form-control form-control-sm" id="asignar-fecha" name="fecha_inicio" value="${hoyISO()}" required>

            <div id="asignar-errores" class="mt-2"></div>
            <div class="d-flex justify-content-end gap-2 mt-3">
                <button type="button" class="btn btn-sm btn-outline-secondary" data-accion="cancelar-asignar">Cancelar</button>
                <button type="submit" class="btn btn-sm btn-eduges" id="btn-confirmar-asignar">Asignar</button>
            </div>
        </form>`;
}

function seccionAsignaciones() {
    const lista = estado.ficha.asignaciones;
    // null: el usuario no puede ver las asignaciones de este profesional (contrato §2)
    if (lista === null) {
        return html`
            <p class="small text-muted mb-0">
                <i class="bi bi-lock me-1" aria-hidden="true"></i>
                Los pacientes asignados solo los ven el administrador y el propio profesional.
            </p>`;
    }
    if (lista instanceof Error) {
        return html`<div class="alert alert-warning small py-2 mb-0" role="alert">
            No se pudieron cargar los pacientes asignados. ${mensajeDeError(lista) ?? ''}
        </div>`;
    }

    const conAcciones = puedeEditar();
    const vigentes = lista.filter((a) => a.vigente);
    const finalizadas = lista.filter((a) => !a.vigente);
    return html`
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h3 class="h6 fw-bold mb-0">
                Pacientes asignados <span class="badge bg-light text-secondary border ms-1">${vigentes.length}</span>
            </h3>
            ${conAcciones && html`
                <button type="button" class="btn btn-sm btn-outline-primary" data-accion="asignar" aria-expanded="false" aria-controls="zona-asignar">
                    <i class="bi bi-person-plus me-1" aria-hidden="true"></i>Asignar paciente
                </button>`}
        </div>
        <div id="zona-asignar"></div>
        ${vigentes.length > 0
            ? html`<ul class="list-unstyled d-flex flex-column gap-2 mb-3">${vigentes.map((a) => itemAsignacion(a, { conAcciones }))}</ul>`
            : bloqueVacio('No tiene pacientes asignados.', 'bi-people')}
        ${finalizadas.length > 0 && html`
            <details class="mt-2">
                <summary class="small fw-semibold text-secondary">Asignaciones finalizadas (${finalizadas.length})</summary>
                <ul class="list-unstyled d-flex flex-column gap-2 mt-2 mb-0">${finalizadas.map((a) => itemAsignacion(a, { conAcciones: false }))}</ul>
            </details>`}`;
}

function seccionEstado(p) {
    const estados = estado.catalogos?.estados_profesionales;
    if (!puedeEditar() || !estados) {
        return '';
    }
    return html`
        <div class="mb-3">
            <div class="small fw-semibold text-secondary mb-1" id="ficha-estado-etiqueta">Cambiar estado</div>
            <div class="btn-group btn-group-sm flex-wrap" role="group" aria-labelledby="ficha-estado-etiqueta">
                ${estados.map((e) => {
                    const actual = e.id === p.estado?.id;
                    return html`
                        <button type="button" class="btn ${actual ? 'btn-primary' : 'btn-outline-secondary'}" data-accion="estado"
                                data-estado-id="${e.id}" aria-pressed="${actual ? 'true' : 'false'}">
                            ${e.nombre}
                        </button>`;
                })}
            </div>
        </div>`;
}

function mostrarFicha() {
    const p = estado.ficha.profesional;
    $('ficha-titulo').textContent = nombreCompleto(p);
    $('ficha-subtitulo').textContent = p.especialidad?.nombre ?? '';

    renderizar($('ficha-cuerpo'), html`
        <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div class="d-flex align-items-center flex-wrap gap-2">
                ${badgeEstadoProfesional(p.estado)}
                <span class="small text-muted">${textoPacientes(p.pacientes_asignados)}</span>
            </div>
            ${puedeEditar() && html`
                <button type="button" class="btn btn-sm btn-outline-secondary" data-accion="editar">
                    <i class="bi bi-pencil me-1" aria-hidden="true"></i>Editar datos
                </button>`}
        </div>

        <dl class="ficha-dato row g-0 mb-3">
            <div class="col-6"><dt>Matrícula</dt><dd>${p.matricula}</dd></div>
            ${'dni' in p && html`<div class="col-6"><dt>DNI</dt><dd>${p.dni}</dd></div>`}
            <div class="col-6"><dt>Teléfono</dt><dd>${enlaceTelefono(p.contacto)}</dd></div>
            ${p.usuario && html`<div class="col-6"><dt>Usuario</dt><dd><code>${p.usuario.usuario}</code></dd></div>`}
            <div class="col-12"><dt>Mail</dt><dd>${enlaceMail(p.mail)}</dd></div>
        </dl>

        ${seccionEstado(p)}

        <hr class="my-3">
        ${seccionAsignaciones()}`);
}

// Cuando la ficha se vuelve a dibujar, los botones se reemplazan: se recuerda cuál tenía
// el foco para devolvérselo al equivalente, así quien usa teclado no pierde su lugar.
function focoEnFicha() {
    const elemento = document.activeElement;
    if (!elemento || !$('ficha-cuerpo').contains(elemento)) {
        return null;
    }
    return { accion: elemento.dataset.accion, estadoId: elemento.dataset.estadoId };
}

function restaurarFoco(foco) {
    if (!foco) {
        return;
    }
    const cuerpo = $('ficha-cuerpo');
    const selector = `[data-accion="${foco.accion}"]${foco.estadoId ? `[data-estado-id="${foco.estadoId}"]` : ''}`;
    const destino = (foco.accion && cuerpo.querySelector(selector))
        ?? cuerpo.querySelector('[data-accion="asignar"]')
        ?? cuerpo.querySelector('[data-accion="editar"]');
    destino?.focus();
}

// silencioso: vuelve a pedir los datos sin mostrar el estado de carga (después de un cambio)
// foco: a qué botón devolver el foco al terminar (si no se indica, al que lo tenía)
async function abrirFicha(id, { silencioso = false, foco: focoIndicado = null } = {}) {
    const ficha = estado.ficha;
    ficha.controlador?.abort();
    ficha.controlador = new AbortController();
    const { signal } = ficha.controlador;
    const foco = focoIndicado ?? (silencioso ? focoEnFicha() : null);

    ficha.id = id;
    guardarEstadoEnUrl();

    if (!silencioso) {
        // Mientras carga se muestra lo que ya se sabe por el listado
        const delListado = estado.profesionales.get(id);
        $('ficha-titulo').textContent = delListado ? nombreCompleto(delListado) : 'Ficha del profesional';
        $('ficha-subtitulo').textContent = delListado?.especialidad?.nombre ?? '';
        renderizar($('ficha-cuerpo'), bloqueCargando(5));
        panelFicha().show();
    }

    const puedeVerAsignaciones = esAdmin() || estado.usuario.profesional?.id === id;
    const [resultadoProfesional, resultadoAsignaciones] = await Promise.allSettled([
        profesionales.obtener(id, { signal }),
        puedeVerAsignaciones ? asignaciones.listar({ profesional: id }, { signal }) : Promise.resolve(null),
    ]);
    if (signal.aborted) {
        return; // se cerró o se abrió otra ficha mientras cargaba
    }

    if (resultadoProfesional.status === 'rejected') {
        ficha.profesional = null;
        // 404: no existe (o no es visible). Reintentar no tiene sentido.
        if (resultadoProfesional.reason.status === 404) {
            $('ficha-titulo').textContent = 'Ficha del profesional';
            $('ficha-subtitulo').textContent = '';
            renderizar($('ficha-cuerpo'), bloqueVacio('No se encontró este profesional.', 'bi-person-x'));
        } else {
            mostrarError($('ficha-cuerpo'), resultadoProfesional.reason, () => abrirFicha(id));
        }
        return;
    }

    ficha.profesional = resultadoProfesional.value;
    ficha.asignaciones = resultadoAsignaciones.status === 'fulfilled' ? resultadoAsignaciones.value : resultadoAsignaciones.reason;
    ficha.pacienteElegido = null;
    mostrarFicha();
    restaurarFoco(foco);
}

// Después de guardar un cambio: ficha y listado al día, sin parpadeo.
// Los botones que muestran "cargando" se deshabilitan y pierden el foco:
// por eso cada acción indica a dónde tiene que volver.
function refrescarTodo(foco = null) {
    if (estado.ficha.id !== null) {
        abrirFicha(estado.ficha.id, { silencioso: true, foco });
    }
    cargarListado({ silencioso: true });
}

// ------------------------------------------------------------
// Cambio de estado (5.5)
// ------------------------------------------------------------
async function cambiarEstado(boton) {
    const p = estado.ficha.profesional;
    const nuevo = estado.catalogos.estados_profesionales.find((e) => e.id === Number(boton.dataset.estadoId));
    if (!p || !nuevo || nuevo.id === p.estado?.id) {
        return;
    }

    if (esEstado(nuevo, 'inactivo')) {
        const aviso = p.pacientes_asignados > 0
            ? ` Tiene ${textoPacientes(p.pacientes_asignados)}: las asignaciones no se modifican.`
            : '';
        const aceptado = await confirmar({
            titulo: '¿Dar de baja al profesional?',
            mensaje: `${nombreCompleto(p)} pasa a Inactivo y no se le van a poder dar turnos nuevos.${aviso}`,
            textoAceptar: 'Dar de baja',
            peligro: true,
        });
        if (!aceptado) {
            return;
        }
    }

    botonCargando(boton, true, '');
    try {
        await profesionales.actualizar(p.id, { estado_id: nuevo.id });
        notificar(`${nombreCompleto(p)} ahora está en estado ${nuevo.nombre}.`);
        refrescarTodo({ accion: 'estado', estadoId: String(nuevo.id) });
    } catch (error) {
        botonCargando(boton, false);
        notificarError(error);
    }
}

// ------------------------------------------------------------
// Asignaciones (5.6)
// ------------------------------------------------------------
function mostrarResultadosPacientes(lista) {
    const vigentes = new Set((estado.ficha.asignaciones ?? []).filter((a) => a.vigente).map((a) => a.paciente.id));
    const contenedor = $('asignar-resultados');
    if (!contenedor) {
        return;
    }
    if (lista.length === 0) {
        renderizar(contenedor, html`<div class="small text-muted py-2">No se encontraron pacientes activos.</div>`);
        return;
    }
    renderizar(contenedor, lista.map((paciente) => {
        const yaAsignado = vigentes.has(paciente.id);
        const elegido = estado.ficha.pacienteElegido?.id === paciente.id;
        return html`
            <button type="button" class="list-group-item list-group-item-action small d-flex justify-content-between align-items-center ${elegido ? 'active' : ''}"
                    data-accion="elegir-paciente" data-paciente-id="${paciente.id}" aria-pressed="${elegido ? 'true' : 'false'}"
                    ${yaAsignado ? html`disabled` : ''}>
                <span>${nombreCompleto(paciente, { apellidoPrimero: true })} <span class="${elegido ? '' : 'text-muted'}">· DNI ${paciente.dni}</span></span>
                ${yaAsignado && html`<span class="badge bg-light text-secondary border">Ya asignado</span>`}
            </button>`;
    }));
    estado.ficha.resultadosPacientes = new Map(lista.map((p) => [p.id, p]));
}

async function buscarPacientes(q) {
    const ficha = estado.ficha;
    ficha.buscador?.abort();
    ficha.buscador = new AbortController();
    const contenedor = $('asignar-resultados');
    if (!contenedor) {
        return;
    }
    renderizar(contenedor, bloqueCargando(2));
    try {
        const pagina = await pacientes.listar(
            { q, estado: ESTADO_PACIENTE.ACTIVO, page_size: RESULTADOS_BUSCADOR },
            { signal: ficha.buscador.signal },
        );
        mostrarResultadosPacientes(pagina.results);
    } catch (error) {
        if (error.name !== 'AbortError' && $('asignar-resultados')) {
            renderizar($('asignar-resultados'), html`<div class="small text-danger py-2">${mensajeDeError(error)}</div>`);
        }
    }
}

function abrirAsignar(boton) {
    const zona = $('zona-asignar');
    if (zona.childElementCount > 0) {
        cerrarAsignar();
        return;
    }
    estado.ficha.pacienteElegido = null;
    renderizar(zona, formularioAsignar());
    boton.setAttribute('aria-expanded', 'true');

    const buscador = $('asignar-buscar');
    const buscar = demorar(() => buscarPacientes(buscador.value.trim()), 300);
    buscador.addEventListener('input', () => {
        buscador.classList.remove('is-invalid');
        buscar();
    });
    $('form-asignar').addEventListener('submit', confirmarAsignacion);
    buscarPacientes('');
    buscador.focus();
}

function cerrarAsignar() {
    estado.ficha.buscador?.abort();
    estado.ficha.pacienteElegido = null;
    renderizar($('zona-asignar'), '');
    const boton = $('ficha-cuerpo').querySelector('[data-accion="asignar"]');
    boton?.setAttribute('aria-expanded', 'false');
    boton?.focus();
}

function elegirPaciente(boton) {
    const paciente = estado.ficha.resultadosPacientes?.get(Number(boton.dataset.pacienteId));
    if (!paciente) {
        return;
    }
    estado.ficha.pacienteElegido = paciente;
    $('asignar-buscar').classList.remove('is-invalid');
    $('ficha-cuerpo').querySelectorAll('[data-accion="elegir-paciente"]').forEach((b) => {
        const elegido = b === boton;
        b.classList.toggle('active', elegido);
        b.setAttribute('aria-pressed', elegido ? 'true' : 'false');
    });
}

async function confirmarAsignacion(evento) {
    evento.preventDefault();
    const formulario = $('form-asignar');
    const boton = $('btn-confirmar-asignar');
    const fecha = $('asignar-fecha').value;
    const paciente = estado.ficha.pacienteElegido;
    renderizar($('asignar-errores'), '');

    const errores = {};
    if (!paciente) {
        errores.paciente_id = ['Elegí un paciente de la lista.'];
    }
    if (!fecha) {
        errores.fecha_inicio = ['Indicá la fecha de inicio.'];
    }
    if (Object.keys(errores).length > 0) {
        mostrarErroresFormulario(formulario, new ApiError(400, errores));
        return;
    }

    limpiarErroresFormulario(formulario);
    botonCargando(boton, true, 'Asignando…');
    try {
        await asignaciones.crear(paciente.id, estado.ficha.profesional.id, fecha);
        notificar(`Se asignó ${nombreCompleto(paciente)} a ${nombreCompleto(estado.ficha.profesional)}.`);
        refrescarTodo({ accion: 'asignar' });
    } catch (error) {
        botonCargando(boton, false);
        const generales = mostrarErroresFormulario(formulario, error);
        if (generales.length > 0) {
            renderizar($('asignar-errores'), html`<div class="alert alert-danger small py-2 mb-0" role="alert">${generales.map((m) => html`<div>${m}</div>`)}</div>`);
        }
    }
}

async function finalizarAsignacion(boton) {
    const id = Number(boton.closest('[data-asignacion-id]').dataset.asignacionId);
    const asignacion = estado.ficha.asignaciones.find((a) => a.id === id);
    if (!asignacion) {
        return;
    }
    const hoy = hoyISO();
    const aceptado = await confirmar({
        titulo: '¿Finalizar la asignación?',
        mensaje: `La asignación de ${nombreCompleto(asignacion.paciente)} con ${nombreCompleto(estado.ficha.profesional)} `
            + `termina hoy (${formatearFecha(hoy)}).`,
        textoAceptar: 'Finalizar',
        peligro: true,
    });
    if (!aceptado) {
        return;
    }

    botonCargando(boton, true, '');
    try {
        await asignaciones.finalizar(id, hoy);
        notificar('Asignación finalizada.');
        refrescarTodo({ accion: 'asignar' });
    } catch (error) {
        botonCargando(boton, false);
        notificarError(error);
    }
}

// ------------------------------------------------------------
// Alta y edición (5.4 y 5.5)
// ------------------------------------------------------------
const modalProfesional = () => window.bootstrap.Modal.getOrCreateInstance($('modal-profesional'));

const CAMPOS_EDITABLES = ['nombre', 'apellido', 'dni', 'matricula', 'especialidad_id', 'contacto', 'mail'];

function abrirFormulario(modo, profesional = null) {
    const formulario = $('form-profesional');
    const f = estado.formulario;
    f.modo = modo;
    f.id = profesional?.id ?? null;
    f.focoAnterior = document.activeElement;

    formulario.reset();
    limpiarErroresFormulario(formulario);
    renderizar($('form-profesional-errores'), '');

    const esAlta = modo === 'crear';
    $('modal-profesional-titulo').textContent = esAlta ? 'Nuevo profesional' : `Editar datos de ${nombreCompleto(profesional)}`;
    $('grupo-usuario').classList.toggle('d-none', !esAlta);
    $('grupo-usuario').disabled = !esAlta;
    $('btn-guardar-profesional').textContent = esAlta ? 'Crear profesional' : 'Guardar cambios';

    if (!esAlta) {
        formulario.elements.nombre.value = profesional.nombre;
        formulario.elements.apellido.value = profesional.apellido;
        formulario.elements.dni.value = profesional.dni ?? '';
        formulario.elements.matricula.value = profesional.matricula;
        formulario.elements.especialidad_id.value = profesional.especialidad?.id ?? '';
        formulario.elements.contacto.value = profesional.contacto ?? '';
        formulario.elements.mail.value = profesional.mail ?? '';
    }
    modalProfesional().show();
}

function leerFormulario() {
    const campos = $('form-profesional').elements;
    const texto = (nombre) => campos[nombre].value.trim();
    const datos = {
        nombre: texto('nombre'),
        apellido: texto('apellido'),
        dni: texto('dni'),
        matricula: texto('matricula'),
        especialidad_id: enteroDeUrl(campos.especialidad_id.value),
        contacto: texto('contacto') || null,
        mail: texto('mail') || null,
    };
    if (estado.formulario.modo === 'crear') {
        datos.usuario = {
            usuario: texto('usuario.usuario'),
            password: campos['usuario.password'].value,
        };
    }
    return datos;
}

// Mismas reglas que la API (contrato §8), para avisar antes de enviar
function validarFormulario(datos) {
    const errores = {};
    const obligatorio = 'Este campo es obligatorio.';
    for (const campo of ['nombre', 'apellido', 'dni', 'matricula']) {
        if (!datos[campo]) {
            errores[campo] = [obligatorio];
        }
    }
    if (!datos.especialidad_id) {
        errores.especialidad_id = ['Elegí una especialidad.'];
    }
    if (datos.dni && !/^\d{7,8}$/.test(datos.dni)) {
        errores.dni = ['El DNI debe tener 7 u 8 dígitos, sin puntos.'];
    }
    if (datos.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.mail)) {
        errores.mail = ['Ingresá un mail válido.'];
    }
    if (datos.usuario) {
        if (!datos.usuario.usuario) {
            errores['usuario.usuario'] = [obligatorio];
        } else if (!/^[a-zA-Z0-9._-]{3,}$/.test(datos.usuario.usuario)) {
            errores['usuario.usuario'] = ['Usá al menos 3 caracteres: letras, números, punto, guion o guion bajo.'];
        }
        if (datos.usuario.password.length < 8) {
            errores['usuario.password'] = ['La contraseña debe tener al menos 8 caracteres.'];
        }
    }
    return errores;
}

function mostrarErroresDelFormulario(error) {
    const formulario = $('form-profesional');
    // El DNI duplicado llega como 409 sin campo: se muestra en el campo DNI
    const aMostrar = error.codigo === 'dni_duplicado' ? new ApiError(400, { dni: [error.message] }) : error;
    const generales = mostrarErroresFormulario(formulario, aMostrar);
    renderizar($('form-profesional-errores'), generales.length > 0
        ? html`<div class="alert alert-danger small py-2" role="alert">${generales.map((m) => html`<div>${m}</div>`)}</div>`
        : '');
    formulario.querySelector('.is-invalid')?.focus();
}

async function guardarProfesional(evento) {
    evento.preventDefault();
    const boton = $('btn-guardar-profesional');
    const datos = leerFormulario();
    const errores = validarFormulario(datos);
    if (Object.keys(errores).length > 0) {
        mostrarErroresDelFormulario(new ApiError(400, errores));
        return;
    }

    limpiarErroresFormulario($('form-profesional'));
    renderizar($('form-profesional-errores'), '');
    botonCargando(boton, true);
    const { modo, id } = estado.formulario;

    try {
        if (modo === 'crear') {
            const nuevo = await profesionales.crear(datos);
            botonCargando(boton, false);
            modalProfesional().hide();
            notificar(`Alta de ${nombreCompleto(nuevo)} registrada. Usuario: ${nuevo.usuario?.usuario ?? datos.usuario.usuario}.`);
            // Se muestra el listado actualizado y la ficha del profesional nuevo
            estado.formulario.focoAnterior = null;
            cargarListado({ silencioso: true });
            abrirFicha(nuevo.id);
        } else {
            const cambios = Object.fromEntries(CAMPOS_EDITABLES.map((c) => [c, datos[c]]));
            await profesionales.actualizar(id, cambios);
            botonCargando(boton, false);
            // Se refresca cuando el modal terminó de cerrarse y el foco volvió a "Editar datos"
            $('modal-profesional').addEventListener('hidden.bs.modal', () => refrescarTodo(), { once: true });
            modalProfesional().hide();
            notificar('Datos guardados.');
        }
    } catch (error) {
        botonCargando(boton, false);
        mostrarErroresDelFormulario(error);
    }
}

function prepararFormulario() {
    $('btn-nuevo-profesional').addEventListener('click', () => abrirFormulario('crear'));
    $('form-profesional').addEventListener('submit', guardarProfesional);

    const modal = $('modal-profesional');
    modal.addEventListener('shown.bs.modal', () => $('prof-nombre').focus());
    modal.addEventListener('hidden.bs.modal', () => {
        // El modal se abre por código: Bootstrap no devuelve el foco solo
        const anterior = estado.formulario.focoAnterior;
        if (anterior?.isConnected) {
            anterior.focus();
        }
    });
    // Al corregir un campo se le saca la marca de error
    $('form-profesional').addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
}

// ------------------------------------------------------------
// Eventos de la ficha
// ------------------------------------------------------------
// Bootstrap desactiva la "trampa de foco" del panel cuando se abre un modal encima (editar,
// confirmaciones) y no la vuelve a activar al cerrarlo. Mientras el panel está abierto y no hay
// modales, el foco no puede salir de él (Tab vuelve al primer elemento; Shift+Tab, al último).
let ultimaTabHaciaAtras = false;

function mantenerFocoEnFicha(evento) {
    const panel = $('ficha-profesional');
    if (!panel.classList.contains('show') || document.querySelector('.modal.show') || panel.contains(evento.target)) {
        return;
    }
    const enfocables = [...panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary',
    )].filter((elemento) => elemento.offsetParent !== null);
    const destino = ultimaTabHaciaAtras ? enfocables.at(-1) : enfocables[0];
    (destino ?? panel).focus();
}

const ACCIONES_FICHA = {
    editar: () => abrirFormulario('editar', estado.ficha.profesional),
    estado: cambiarEstado,
    asignar: abrirAsignar,
    'cancelar-asignar': cerrarAsignar,
    'elegir-paciente': elegirPaciente,
    finalizar: finalizarAsignacion,
};

function prepararFicha() {
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
        const boton = evento.target.closest('button[data-accion]');
        if (boton && ACCIONES_FICHA[boton.dataset.accion]) {
            ACCIONES_FICHA[boton.dataset.accion](boton);
        }
    });

    document.addEventListener('keydown', (evento) => {
        if (evento.key === 'Tab') {
            ultimaTabHaciaAtras = evento.shiftKey;
        }
    });
    document.addEventListener('focusin', mantenerFocoEnFicha);

    $('ficha-profesional').addEventListener('hidden.bs.offcanvas', () => {
        const id = estado.ficha.id;
        estado.ficha.controlador?.abort();
        estado.ficha.buscador?.abort();
        estado.ficha.id = null;
        estado.ficha.profesional = null;
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
    prepararFiltros();
    prepararFicha();
    prepararFormulario();

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

    // Los catálogos se esperan antes de abrir una ficha: la sección de estado los necesita
    const catalogosListos = cargarCatalogos();
    cargarListado();
    if (fichaInicial) {
        await catalogosListos;
        abrirFicha(fichaInicial);
    }
}

iniciar();
