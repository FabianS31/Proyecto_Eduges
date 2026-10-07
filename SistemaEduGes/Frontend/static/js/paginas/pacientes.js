// ============================================================
// EduGes - Módulo Pacientes (templates/pacientes.html)
// Listado con búsqueda, filtro por estado del CUD, orden y paginación;
// ficha en panel lateral; alta de pacientes (profesionales).
//
// Endpoint: GET /api/pacientes/ → array con TODOS los pacientes que el usuario puede ver
// (un profesional, solo los asignados a él; los administradores, todos). Como viene
// todo junto, la búsqueda, el filtro y la paginación se hacen en el navegador.
//
// El estado de la pantalla (búsqueda, filtro, orden, página y ficha abierta) se guarda
// en la URL: /pacientes/?q=perez&cud=vencido&orden=cud&page=2&paciente=5
// El dashboard enlaza a la ficha con /pacientes/?paciente=5.
// ============================================================

import { prepararFormularioPaciente } from '../componentes/formulario-paciente.js';
import {
    enteroDeUrl,
    guardarEnUrl,
    leerUrl,
    mostrarPaginacion,
    paginar,
    prepararPaginacion,
    textoTotal,
} from '../componentes/listado.js';
import { ESTADO_PACIENTE, PERMISO } from '../constantes.js';
import { pacientes } from '../endpoints.js';
import { edad } from '../fechas.js';
import { esProfesional, obtenerUsuario, tienePermiso } from '../layout.js';
import { coincideBusqueda, compararTexto } from '../texto.js';
import {
    badgeCud,
    bloqueCargando,
    bloqueVacio,
    CUD,
    demorar,
    enlaceMail,
    estadoCud,
    filaCompleta,
    formatearFecha,
    html,
    mostrarError,
    nombreCompleto,
    renderizar,
} from '../ui.js';

const COLUMNAS = 5;
const TAMANIO_PAGINA = 10;
const ORDENES = ['apellido', 'cud', 'edad'];
// "alerta" = vencido o por vencer (a donde lleva el número "CUD a vencer" del dashboard)
const ALERTA = 'alerta';
const FILTROS_CUD = [ALERTA, ...Object.values(CUD)];

const $ = (id) => document.getElementById(id);

const estado = {
    usuario: null,
    todos: [],                  // lo que devolvió la API, con el estado del CUD y la edad calculados
    filtros: leerFiltrosDeUrl(),
    fichaId: null,              // paciente con la ficha abierta
};

// ------------------------------------------------------------
// Estado en la URL
// ------------------------------------------------------------
function leerFiltrosDeUrl() {
    const parametros = leerUrl();
    const orden = parametros.get('orden');
    const cud = parametros.get('cud');
    return {
        q: parametros.get('q') ?? '',
        cud: FILTROS_CUD.includes(cud) ? cud : '',
        orden: ORDENES.includes(orden) ? orden : 'apellido',
        page: enteroDeUrl(parametros.get('page')) ?? 1,
    };
}

function guardarEstadoEnUrl() {
    const f = estado.filtros;
    guardarEnUrl({
        q: f.q,
        cud: f.cud,
        orden: f.orden !== 'apellido' ? f.orden : null,
        page: f.page > 1 ? f.page : null,
        paciente: estado.fichaId,
    });
}

// ------------------------------------------------------------
// Búsqueda, filtro y orden (en el navegador)
// ------------------------------------------------------------
// "lucas per" encuentra a "Lucas Pérez"; también por DNI
const coincide = (p, q) => coincideBusqueda([p.nombre, p.apellido, p.dni], q);

const CRITERIOS = {
    apellido: (a, b) => compararTexto(a.apellido, b.apellido) || compararTexto(a.nombre, b.nombre),
    // El CUD más urgente primero (los vencidos hace más tiempo, arriba)
    cud: (a, b) => a.cud.dias - b.cud.dias,
    // De menor a mayor
    edad: (a, b) => a.edad - b.edad || compararTexto(a.apellido, b.apellido),
};

function filtrados() {
    const { q, cud, orden } = estado.filtros;
    return estado.todos
        .filter((p) => !q.trim() || coincide(p, q))
        .filter((p) => !cud || p.cud.clave === cud || (cud === ALERTA && p.cud.clave !== CUD.VIGENTE))
        .sort(CRITERIOS[orden]);
}

// ------------------------------------------------------------
// Presentación
// ------------------------------------------------------------
const textoEdad = (anios) => (anios === 1 ? '1 año' : `${anios} años`);

const NOMBRE_ESTADO_PACIENTE = {
    [ESTADO_PACIENTE.ACTIVO]: 'Activo',
    [ESTADO_PACIENTE.INACTIVO]: 'Inactivo',
};

function filaPaciente(p) {
    return html`
        <tr data-paciente-id="${p.id_paciente}">
            <td>
                <div class="fw-semibold text-dark">${nombreCompleto(p, { apellidoPrimero: true })}</div>
                <div class="text-muted small">
                    <span class="d-none d-sm-inline">Afiliado ${p.numero_afiliado}</span><span class="d-md-none"><span class="d-none d-sm-inline"> · </span>DNI ${p.dni}</span>
                </div>
            </td>
            <td class="d-none d-md-table-cell">${p.dni}</td>
            <td class="d-none d-sm-table-cell">${textoEdad(p.edad)}</td>
            <td>${badgeCud(p.cud_vencimiento)}</td>
            <td class="text-end">
                <button type="button" class="btn btn-sm btn-light border text-primary" data-accion="ver-ficha"
                        aria-label="Ver ficha de ${nombreCompleto(p)}">
                    <i class="bi bi-person-lines-fill" aria-hidden="true"></i><span class="d-none d-md-inline ms-1">Ver ficha</span>
                </button>
            </td>
        </tr>`;
}

// Aviso arriba del listado si hay CUD vencidos o por vencer, con un botón para ver solo esos.
// Lenguaje simple y un botón con texto: se entiende sin conocer el filtro.
const cantidadPacientes = (n) => (n === 1 ? '1 paciente' : `${n} pacientes`);

function mostrarAvisoCud() {
    const aviso = $('aviso-cud');
    const vencidos = estado.todos.filter((p) => p.cud.clave === CUD.VENCIDO).length;
    const porVencer = estado.todos.filter((p) => p.cud.clave === CUD.POR_VENCER).length;
    aviso.hidden = vencidos + porVencer === 0;
    if (aviso.hidden) {
        return;
    }
    const partes = [
        vencidos > 0 && html`<strong>${cantidadPacientes(vencidos)}</strong> con el CUD vencido`,
        porVencer > 0 && html`<strong>${cantidadPacientes(porVencer)}</strong> con el CUD por vencer en los próximos 60 días`,
    ].filter(Boolean);
    const viendoSoloEsos = estado.filtros.cud === ALERTA;
    renderizar(aviso, html`
        <div class="alert alert-warning d-flex flex-column flex-md-row align-items-md-center gap-3 mb-4" role="region" aria-label="Aviso de CUD">
            <div class="d-flex gap-2 flex-grow-1">
                <i class="bi bi-exclamation-triangle-fill fs-5" aria-hidden="true"></i>
                <div>
                    <div class="fw-semibold">${esProfesional(estado.usuario) ? 'Atención con tus pacientes' : 'Atención'}</div>
                    <div>Hay ${partes.length === 2 ? html`${partes[0]} y ${partes[1]}` : partes[0]}.</div>
                </div>
            </div>
            <button type="button" class="btn btn-warning fw-semibold text-nowrap" data-accion="${viendoSoloEsos ? 'ver-todos' : 'ver-alerta'}">
                ${viendoSoloEsos
                    ? html`<i class="bi bi-list-ul me-1" aria-hidden="true"></i>Ver todos los pacientes`
                    : html`<i class="bi bi-funnel me-1" aria-hidden="true"></i>Ver solo esos pacientes`}
            </button>
        </div>`);
}

// Cantidad de pacientes de cada estado del CUD en las opciones del filtro: "Vencido (2)"
function actualizarConteosCud() {
    const conteo = Object.fromEntries(FILTROS_CUD.map((clave) => [clave, 0]));
    estado.todos.forEach((p) => {
        conteo[p.cud.clave] += 1;
    });
    conteo[ALERTA] = conteo[CUD.VENCIDO] + conteo[CUD.POR_VENCER];
    $('filtro-cud').querySelectorAll('option[value]').forEach((opcion) => {
        if (opcion.value) {
            opcion.dataset.texto ??= opcion.textContent;
            opcion.textContent = `${opcion.dataset.texto} (${conteo[opcion.value]})`;
        }
    });
}

function mensajeVacio() {
    if (estado.filtros.q.trim() || estado.filtros.cud) {
        return 'No hay pacientes que coincidan con la búsqueda.';
    }
    return esProfesional(estado.usuario)
        ? 'Todavía no tenés pacientes asignados.'
        : 'Todavía no hay pacientes cargados.';
}

function mostrarListado() {
    const lista = filtrados();
    const resultado = paginar(lista, estado.filtros.page, TAMANIO_PAGINA);
    estado.filtros.page = resultado.pagina;

    renderizar($('pacientes-cuerpo'), resultado.items.length > 0
        ? resultado.items.map(filaPaciente)
        : filaCompleta(COLUMNAS, bloqueVacio(mensajeVacio(), 'bi-person-x')));

    $('pacientes-total').textContent = textoTotal(lista.length, estado.todos.length, ['paciente', 'pacientes']);
    mostrarAvisoCud();
    mostrarPaginacion($('pacientes-paginacion'), resultado);
    guardarEstadoEnUrl();
}

async function cargarListado() {
    renderizar($('pacientes-cuerpo'), filaCompleta(COLUMNAS, bloqueCargando(3)));
    try {
        const lista = await pacientes.listar();
        estado.todos = lista.map((p) => ({ ...p, cud: estadoCud(p.cud_vencimiento), edad: edad(p.fecha_nacimiento) }));
        actualizarConteosCud();
        mostrarListado();
        return true;
    } catch (error) {
        $('pacientes-total').textContent = '';
        $('pacientes-paginacion').classList.add('d-none');
        mostrarError($('pacientes-cuerpo'), error, () => cargarListado(), { colspan: COLUMNAS });
        return false;
    }
}

// ------------------------------------------------------------
// Ficha (con los datos del listado: la API todavía no tiene el detalle de un paciente)
// ------------------------------------------------------------
const panelFicha = () => window.bootstrap.Offcanvas.getOrCreateInstance($('ficha-paciente'));

function abrirFicha(id) {
    const p = estado.todos.find((paciente) => paciente.id_paciente === id);
    estado.fichaId = p ? id : null;
    guardarEstadoEnUrl();

    if (!p) {
        // No existe, o no es de este profesional
        $('ficha-titulo').textContent = 'Ficha del paciente';
        $('ficha-subtitulo').textContent = '';
        renderizar($('ficha-cuerpo'), bloqueVacio('No se encontró este paciente entre los que podés ver.', 'bi-person-x'));
        panelFicha().show();
        return;
    }

    const estadoPaciente = NOMBRE_ESTADO_PACIENTE[p.estado] ?? '—';
    $('ficha-titulo').textContent = nombreCompleto(p);
    $('ficha-subtitulo').textContent = `DNI ${p.dni} · ${textoEdad(p.edad)}`;

    renderizar($('ficha-cuerpo'), html`
        <div class="d-flex align-items-center flex-wrap gap-2 mb-3">
            ${badgeCud(p.cud_vencimiento)}
            <span class="badge ${p.estado === ESTADO_PACIENTE.ACTIVO ? 'badge-cud-vigente' : 'bg-secondary'}">
                <i class="bi ${p.estado === ESTADO_PACIENTE.ACTIVO ? 'bi-person-check' : 'bi-person-dash'} me-1" aria-hidden="true"></i>${estadoPaciente}
            </span>
        </div>

        <h3 class="h6 fw-bold mt-2 mb-2">Datos personales</h3>
        <dl class="ficha-dato row g-0 mb-3">
            <div class="col-6"><dt>Nacimiento</dt><dd>${formatearFecha(p.fecha_nacimiento)}</dd></div>
            <div class="col-6"><dt>Edad</dt><dd>${textoEdad(p.edad)}</dd></div>
            <div class="col-12"><dt>Dirección</dt><dd>${p.direccion}</dd></div>
            <div class="col-12"><dt>Mail</dt><dd>${enlaceMail(p.mail)}</dd></div>
        </dl>

        <h3 class="h6 fw-bold mb-2">Obra social y CUD</h3>
        <dl class="ficha-dato row g-0 mb-3">
            <div class="col-6"><dt>N° de afiliado</dt><dd>${p.numero_afiliado}</dd></div>
            <div class="col-6"><dt>N° de CUD</dt><dd>${p.cud_numero ?? html`<span class="text-muted">—</span>`}</dd></div>
            <div class="col-12"><dt>Vencimiento del CUD</dt><dd>${formatearFecha(p.cud_vencimiento)}</dd></div>
        </dl>

        <h3 class="h6 fw-bold mb-2">Consentimiento informado</h3>
        <p class="small mb-0">
            ${p.consentimiento
                ? html`<i class="bi bi-check-circle-fill text-success me-1" aria-hidden="true"></i>Firmado`
                : html`<i class="bi bi-exclamation-circle-fill text-danger me-1" aria-hidden="true"></i>Sin firmar`}
        </p>`);
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
    const formulario = $('filtros-pacientes');
    const busqueda = $('filtro-q');
    const cud = $('filtro-cud');
    const orden = $('filtro-orden');
    busqueda.value = estado.filtros.q;
    cud.value = estado.filtros.cud;
    orden.value = estado.filtros.orden;

    const buscar = demorar(() => cambiarFiltros({ q: busqueda.value }), 200);
    busqueda.addEventListener('input', buscar);
    cud.addEventListener('change', () => cambiarFiltros({ cud: cud.value }));
    orden.addEventListener('change', () => cambiarFiltros({ orden: orden.value }));
    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        cambiarFiltros({ q: busqueda.value });
    });
    formulario.addEventListener('reset', () => {
        // El reset del navegador vacía los campos después de este evento
        setTimeout(() => cambiarFiltros({ q: '', cud: '', orden: 'apellido' }));
    });

    prepararPaginacion($('pacientes-paginacion'), (cambio) => {
        estado.filtros.page += cambio;
        mostrarListado();
    });

    // Botón del aviso de CUD: filtra (vencidos y por vencer, el más urgente primero) o vuelve a todos
    $('aviso-cud').addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-accion]');
        if (!boton) {
            return;
        }
        const soloAlerta = boton.dataset.accion === 'ver-alerta';
        cud.value = soloAlerta ? ALERTA : '';
        orden.value = soloAlerta ? 'cud' : 'apellido';
        cambiarFiltros({ cud: cud.value, orden: orden.value });
        // El botón se redibuja: el foco pasa al mismo lugar, con el texto nuevo
        $('aviso-cud').querySelector('[data-accion]')?.focus();
    });

    $('pacientes-cuerpo').addEventListener('click', (evento) => {
        const fila = evento.target.closest('tr[data-paciente-id]');
        if (fila) {
            abrirFicha(Number(fila.dataset.pacienteId));
        }
    });

    $('ficha-paciente').addEventListener('hidden.bs.offcanvas', () => {
        const id = estado.fichaId;
        estado.fichaId = null;
        guardarEstadoEnUrl();
        // El panel se abre por código: Bootstrap no devuelve el foco solo
        document.querySelector(`tr[data-paciente-id="${id}"] [data-accion="ver-ficha"]`)?.focus();
    });
}

// Solo un profesional da de alta pacientes desde acá: la API se los asigna a él
function prepararAlta() {
    const usuario = estado.usuario;
    if (!esProfesional(usuario) || !tienePermiso(usuario, PERMISO.PACIENTES_EDITAR)) {
        return;
    }
    const abrirNuevoPaciente = prepararFormularioPaciente({
        alGuardar: async (creado) => {
            if (await cargarListado()) {
                abrirFicha(creado.id_paciente);
            }
        },
    });
    const boton = $('btn-nuevo-paciente');
    boton.hidden = false;
    boton.addEventListener('click', abrirNuevoPaciente);
}

// ------------------------------------------------------------
// Inicio
// ------------------------------------------------------------
async function iniciar() {
    // Se lee antes de cargar el listado, que reescribe la URL
    const fichaInicial = enteroDeUrl(new URLSearchParams(window.location.search).get('paciente'));
    prepararEventos();

    try {
        estado.usuario = await obtenerUsuario();
    } catch (error) {
        // 401: api.js ya redirige al login
        if (error.status !== 401) {
            mostrarError($('pacientes-cuerpo'), error, () => window.location.reload(), { colspan: COLUMNAS });
        }
        return;
    }

    const propios = esProfesional(estado.usuario);
    $('pacientes-subtitulo').textContent = propios ? 'Pacientes asignados a vos' : 'Todos los pacientes del centro';
    $('pacientes-titulo-listado').textContent = propios ? 'Mis pacientes' : 'Pacientes';

    if (!tienePermiso(estado.usuario, PERMISO.PACIENTES_VER)) {
        renderizar($('pacientes-cuerpo'),
            filaCompleta(COLUMNAS, bloqueVacio('No tenés acceso al listado de pacientes.', 'bi-lock')));
        return;
    }

    prepararAlta();
    if (await cargarListado() && fichaInicial) {
        abrirFicha(fichaInicial);
    }
}

iniciar();
