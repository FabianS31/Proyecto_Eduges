// ============================================================
// EduGes - Módulo Pacientes (templates/pacientes.html)
// Listado con búsqueda, filtro por estado del CUD, orden y paginación;
// ficha en panel lateral (con sus turnos: agendar, reprogramar y cancelar);
// alta de pacientes (profesionales).
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
import {
    actualizarConLaHora,
    estaActivo,
    formatearHora,
    listaTurnos,
    obtenerTurnos,
    prepararTurnos,
    yaEmpezo,
} from '../componentes/turnos.js';
import { ESTADO_PACIENTE, PERMISO } from '../constantes.js';
import { pacientes } from '../endpoints.js';
import { aFecha, edad, hoyISO, sumarDias } from '../fechas.js';
import { esProfesional, obtenerUsuario, tienePermiso } from '../layout.js';
import { coincideBusqueda, compararTexto } from '../texto.js';
import {
    badgeCud,
    bloqueCargando,
    bloqueVacio,
    celdaCud,
    CUD,
    demorar,
    enlaceMail,
    estadoCud,
    formatearFecha,
    html,
    icono,
    iniciales,
    mostrarError,
    nombreCompleto,
    renderizar,
} from '../ui.js';

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
    proximos: new Map(),        // id de paciente → su próximo turno (para la tabla)
    conTurnos: false,           // si se pudieron cargar los turnos (si no, la tabla muestra el N° de afiliado)
    acciones: null,             // turnos: agendar, reprogramar y cancelar (componentes/turnos.js)
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

// "44210983" → "44.210.983" (más fácil de leer)
const formatearDni = (dni) => String(dni ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const FORMATO_DIA_CORTO = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });

// "Próx. turno: hoy 10:30" / "mañana 9:00" / "lun 19/10 14:00"
function textoProximoTurno(turno) {
    if (!turno) {
        return 'Sin próximo turno';
    }
    let dia = FORMATO_DIA_CORTO.format(aFecha(turno.fecha)).replace(',', '').replace('.', '');
    if (turno.fecha === hoyISO()) {
        dia = 'hoy';
    } else if (turno.fecha === sumarDias(hoyISO(), 1)) {
        dia = 'mañana';
    }
    return `Próx. turno: ${dia} ${formatearHora(turno.hora)}`;
}

function filaPaciente(p) {
    const meta = estado.conTurnos
        ? textoProximoTurno(estado.proximos.get(p.id_paciente))
        : `Afiliado ${p.numero_afiliado}`;
    return html`
        <div class="eg-table__row" role="row" data-paciente-id="${p.id_paciente}">
            <div class="eg-table__main" role="cell">
                <div class="eg-avatar eg-avatar--blue" aria-hidden="true">${iniciales(p)}</div>
                <div>
                    <div class="eg-table__name">${nombreCompleto(p, { apellidoPrimero: true })}</div>
                    <div class="eg-table__meta">${meta}</div>
                </div>
            </div>
            <span class="eg-table__num" role="cell"><span class="visually-hidden">DNI </span>${formatearDni(p.dni)}</span>
            <span role="cell">${textoEdad(p.edad)}</span>
            <div role="cell">${celdaCud(p.cud_vencimiento)}</div>
            <div class="eg-table__action" role="cell">
                <button type="button" class="eg-btn" data-accion="ver-ficha" aria-label="Ver ficha de ${nombreCompleto(p)}">
                    ${icono('folder_open')}Ver ficha
                </button>
            </div>
        </div>`;
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
        porVencer > 0 && html`<strong>${cantidadPacientes(porVencer)}</strong> con el CUD por vencer en los próximos 3 meses`,
    ].filter(Boolean);
    const viendoSoloEsos = estado.filtros.cud === ALERTA;
    renderizar(aviso, html`
        <div class="eg-alert eg-alert--warn" role="region" aria-label="Aviso de CUD">
            ${icono('warning', 'eg-alert__icon')}
            <div class="eg-alert__text">
                <span class="eg-alert__title">${esProfesional(estado.usuario) ? 'Atención con tus pacientes' : 'Atención'}</span>
                Hay ${partes.length === 2 ? html`${partes[0]} y ${partes[1]}` : partes[0]}.
            </div>
            <button type="button" class="eg-btn eg-btn--secondary" data-accion="${viendoSoloEsos ? 'ver-todos' : 'ver-alerta'}">
                ${viendoSoloEsos
                    ? html`${icono('list')}Ver todos los pacientes`
                    : html`${icono('filter_alt')}Ver solo esos pacientes`}
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

    renderizar($('pacientes-cuerpo'), resultado.items.map(filaPaciente));
    renderizar($('pacientes-estado'), resultado.items.length > 0 ? '' : bloqueVacio(mensajeVacio(), 'person_search'));

    $('pacientes-total').textContent = textoTotal(lista.length, estado.todos.length, ['paciente', 'pacientes']);
    mostrarAvisoCud();
    mostrarPaginacion($('pacientes-paginacion'), resultado);
    guardarEstadoEnUrl();
}

// Próximo turno de cada paciente (para la tabla). Si falla, la tabla muestra el N° de afiliado.
async function cargarProximos() {
    if (!estado.acciones) {
        return;
    }
    try {
        const lista = await obtenerTurnos();
        estado.proximos = new Map();
        lista.filter((t) => estaActivo(t) && !yaEmpezo(t)).forEach((t) => {
            if (!estado.proximos.has(t.paciente_id)) {
                estado.proximos.set(t.paciente_id, t);
            }
        });
        estado.conTurnos = true;
    } catch {
        estado.conTurnos = false;
    }
}

async function cargarListado() {
    renderizar($('pacientes-cuerpo'), '');
    renderizar($('pacientes-estado'), bloqueCargando(3));
    try {
        const [lista] = await Promise.all([pacientes.listar(), cargarProximos()]);
        estado.todos = lista.map((p) => ({ ...p, cud: estadoCud(p.cud_vencimiento), edad: edad(p.fecha_nacimiento) }));
        actualizarConteosCud();
        mostrarListado();
        return true;
    } catch (error) {
        $('pacientes-total').textContent = '';
        $('pacientes-paginacion').classList.add('d-none');
        mostrarError($('pacientes-estado'), error, () => cargarListado());
        return false;
    }
}

// ------------------------------------------------------------
// Ficha (con los datos del listado: la API todavía no tiene el detalle de un paciente).
// Recuadro grande en el medio: a la izquierda los datos, a la derecha los turnos.
// ------------------------------------------------------------
const panelFicha = () => window.bootstrap.Modal.getOrCreateInstance($('ficha-paciente'));

function abrirFicha(id) {
    const p = estado.todos.find((paciente) => paciente.id_paciente === id);
    estado.fichaId = p ? id : null;
    guardarEstadoEnUrl();

    if (!p) {
        // No existe, o no es de este profesional
        $('ficha-titulo').textContent = 'Ficha del paciente';
        $('ficha-subtitulo').textContent = '';
        renderizar($('ficha-cuerpo'), bloqueVacio('No se encontró este paciente entre los que podés ver.', 'person_search'));
        panelFicha().show();
        return;
    }

    const estadoPaciente = NOMBRE_ESTADO_PACIENTE[p.estado] ?? '—';
    $('ficha-titulo').textContent = nombreCompleto(p);
    $('ficha-subtitulo').textContent = `DNI ${p.dni} · ${textoEdad(p.edad)}`;

    renderizar($('ficha-cuerpo'), html`
        <div class="eg-ficha${estado.acciones ? '' : ' eg-ficha--una'}">
            <div class="eg-ficha__datos">
                <div class="eg-ficha__chips">
                    ${badgeCud(p.cud_vencimiento)}
                    <span class="eg-chip ${p.estado === ESTADO_PACIENTE.ACTIVO ? 'eg-chip--ok' : ''}">
                        ${icono(p.estado === ESTADO_PACIENTE.ACTIVO ? 'person_check' : 'person_off')}${estadoPaciente}
                    </span>
                </div>

                <section class="eg-ficha__bloque" aria-labelledby="ficha-datos-titulo">
                    <h3 id="ficha-datos-titulo">${icono('person')}Datos personales</h3>
                    <dl class="ficha-dato row g-0">
                        <div class="col-6"><dt>Nacimiento</dt><dd>${formatearFecha(p.fecha_nacimiento)}</dd></div>
                        <div class="col-6"><dt>Edad</dt><dd>${textoEdad(p.edad)}</dd></div>
                        <div class="col-12"><dt>Dirección</dt><dd>${p.direccion}</dd></div>
                        <div class="col-12"><dt>Mail</dt><dd>${enlaceMail(p.mail)}</dd></div>
                    </dl>
                </section>

                <section class="eg-ficha__bloque" aria-labelledby="ficha-cud-titulo">
                    <h3 id="ficha-cud-titulo">${icono('verified_user')}Obra social y CUD</h3>
                    <dl class="ficha-dato row g-0">
                        <div class="col-6"><dt>N° de afiliado</dt><dd>${p.numero_afiliado}</dd></div>
                        <div class="col-6"><dt>N° de CUD</dt><dd>${p.cud_numero ?? html`<span class="text-muted">—</span>`}</dd></div>
                        <div class="col-12"><dt>Vencimiento del CUD</dt><dd>${formatearFecha(p.cud_vencimiento)}</dd></div>
                    </dl>
                </section>

                <section class="eg-ficha__bloque" aria-labelledby="ficha-consentimiento-titulo">
                    <h3 id="ficha-consentimiento-titulo">${icono('task')}Consentimiento informado</h3>
                    ${p.consentimiento
                        ? html`<span class="eg-chip eg-chip--ok">${icono('check_circle')}Firmado</span>`
                        : html`<span class="eg-chip eg-chip--err">${icono('error')}Sin firmar</span>`}
                </section>
            </div>

            ${estado.acciones && html`
                <section class="eg-ficha__turnos" aria-labelledby="ficha-turnos-titulo">
                    <div class="eg-ficha__turnos-head">
                        <h3 id="ficha-turnos-titulo">${icono('event_note')}Turnos</h3>
                        ${puedeAgendar(p) && html`
                            <button type="button" class="eg-btn" data-accion="agendar-paciente">
                                ${icono('add_circle')}Agendar turno
                            </button>`}
                    </div>
                    <div id="ficha-turnos" aria-live="polite"></div>
                </section>`}
        </div>`);
    panelFicha().show();
    cargarTurnosFicha();
}

// ------------------------------------------------------------
// Turnos del paciente en la ficha: próximos (con reprogramar y cancelar) y anteriores
// ------------------------------------------------------------
const ANTERIORES_A_MOSTRAR = 5;

const puedeAgendar = (p) => p.estado === ESTADO_PACIENTE.ACTIVO && tienePermiso(estado.usuario, PERMISO.TURNOS_EDITAR);

const listaTurnosFicha = (lista) => html`
    <div class="eg-lista-ficha">${listaTurnos(lista, { conPaciente: false, conProfesional: !esProfesional(estado.usuario) })}</div>`;

// silencioso: sin el "cargando" (para la actualización automática con la hora)
async function cargarTurnosFicha({ silencioso = false } = {}) {
    const contenedor = $('ficha-turnos');
    const id = estado.fichaId;
    if (!contenedor || !id) {
        return;
    }
    if (!silencioso) {
        renderizar(contenedor, bloqueCargando(2));
    }
    try {
        const delPaciente = (await obtenerTurnos()).filter((t) => t.paciente_id === id);
        if (estado.fichaId !== id) {
            return;
        }
        const proximos = delPaciente.filter((t) => estaActivo(t) && !yaEmpezo(t));
        // Los más recientes primero
        const anteriores = delPaciente.filter((t) => !proximos.includes(t)).reverse();
        const mostrados = anteriores.slice(0, ANTERIORES_A_MOSTRAR);
        renderizar(contenedor, html`
            <h4 class="eg-ficha__subtitulo">Próximos</h4>
            ${proximos.length > 0
                ? listaTurnosFicha(proximos)
                : html`<p class="eg-ficha__vacio">No tiene turnos próximos.</p>`}
            ${anteriores.length > 0 && html`
                <h4 class="eg-ficha__subtitulo">Anteriores y cancelados</h4>
                ${listaTurnosFicha(mostrados)}
                ${anteriores.length > mostrados.length
                    && html`<p class="eg-ficha__vacio">Se muestran los últimos ${mostrados.length} de ${anteriores.length}.</p>`}`}`);
    } catch (error) {
        if (estado.fichaId === id) {
            mostrarError(contenedor, error, () => cargarTurnosFicha());
        }
    }
}

function prepararTurnosFicha() {
    if (!tienePermiso(estado.usuario, PERMISO.TURNOS_VER)) {
        return;
    }
    estado.acciones = prepararTurnos({
        usuario: estado.usuario,
        // La ficha y el "próximo turno" de la tabla
        alCambiar: () => Promise.all([cargarTurnosFicha(), cargarProximos().then(mostrarListado)]),
        focoTrasCambio: () => $('ficha-turnos-titulo'),
    });
    estado.acciones.escuchar($('ficha-cuerpo'));
    // Con la pantalla abierta: la ficha y el "próximo turno" de la tabla se actualizan
    // solos cuando un turno empieza o termina
    actualizarConLaHora({
        zonas: () => [$('ficha-turnos'), $('pacientes-cuerpo')],
        redibujar: () => Promise.all([cargarTurnosFicha({ silencioso: true }), cargarProximos().then(mostrarListado)]),
    });
    $('ficha-cuerpo').addEventListener('click', (evento) => {
        const paciente = estado.todos.find((p) => p.id_paciente === estado.fichaId);
        if (paciente && evento.target.closest('[data-accion="agendar-paciente"]')) {
            estado.acciones.abrirNuevo({ paciente });
        }
    });
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
        const fila = evento.target.closest('[data-paciente-id]');
        if (fila) {
            abrirFicha(Number(fila.dataset.pacienteId));
        }
    });

    $('ficha-paciente').addEventListener('hidden.bs.modal', (evento) => {
        // Solo cuando se cierra la ficha (no un modal abierto encima, como "Agendar turno")
        if (evento.target !== $('ficha-paciente')) {
            return;
        }
        const id = estado.fichaId;
        estado.fichaId = null;
        guardarEstadoEnUrl();
        // La ficha se abre por código: Bootstrap no devuelve el foco solo
        document.querySelector(`[data-paciente-id="${id}"] [data-accion="ver-ficha"]`)?.focus();
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
            mostrarError($('pacientes-estado'), error, () => window.location.reload());
        }
        return;
    }

    const propios = esProfesional(estado.usuario);
    $('pacientes-subtitulo').textContent = propios ? 'Pacientes asignados a vos' : 'Todos los pacientes del centro';
    $('pacientes-titulo-listado').textContent = propios ? 'Mis pacientes' : 'Pacientes';

    if (!tienePermiso(estado.usuario, PERMISO.PACIENTES_VER)) {
        renderizar($('pacientes-estado'), bloqueVacio('No tenés acceso al listado de pacientes.', 'lock'));
        return;
    }

    prepararAlta();
    prepararTurnosFicha();
    if (await cargarListado() && fichaInicial) {
        abrirFicha(fichaInicial);
    }
}

iniciar();
