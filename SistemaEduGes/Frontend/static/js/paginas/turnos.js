// ============================================================
// EduGes - Módulo Turnos y Agenda (templates/turnos.html)
// Agenda de un día (con las acciones de cada turno) o de una semana (de lunes a domingo,
// cada turno abre su día), con nuevo turno, reprogramar, cancelar y estados (componentes/turnos.js).
//
// Endpoint: GET /api/turnos/ → todos los turnos que el usuario puede ver (un profesional,
// los suyos; los administradores, los de todos). Viene todo junto: el filtro por día,
// semana y profesional se hace en el navegador.
//
// Lo elegido se guarda en la URL: /turnos/?vista=semana&fecha=2026-10-14&profesional=3&cancelados=no
// ============================================================

import { enteroDeUrl, guardarEnUrl, leerUrl } from '../componentes/listado.js';
import {
    actualizarConLaHora,
    claseTurno,
    conMayuscula,
    diaEnTexto,
    estaCancelado,
    fechaMaximaTurno,
    formatearHora,
    listaTurnos,
    nombrePaciente,
    nombreProfesional,
    obtenerTurnos,
    prepararTurnos,
    proximaDeHoy,
} from '../componentes/turnos.js';
import { PERMISO } from '../constantes.js';
import { profesionales } from '../endpoints.js';
import { aFecha, hoyISO, sumarDias } from '../fechas.js';
import { esProfesional, obtenerUsuario, tienePermiso } from '../layout.js';
import { bloqueCargando, bloqueVacio, html, icono, mostrarError, nombreCompleto, renderizar } from '../ui.js';

const $ = (id) => document.getElementById(id);

const VISTAS = ['dia', 'semana'];
const esFechaISO = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(valor ?? '') && !Number.isNaN(aFecha(valor).getTime());

const estado = {
    usuario: null,
    filtros: leerFiltrosDeUrl(),
    acciones: null,
    pedido: 0,          // si se cambia de período rápido, solo se muestra la última respuesta
};

// ------------------------------------------------------------
// Estado en la URL
// ------------------------------------------------------------
function leerFiltrosDeUrl() {
    const parametros = leerUrl();
    const vista = parametros.get('vista');
    const fecha = parametros.get('fecha');
    return {
        vista: VISTAS.includes(vista) ? vista : 'dia',
        fecha: esFechaISO(fecha) ? fecha : hoyISO(),
        profesional: enteroDeUrl(parametros.get('profesional')),
        ocultarCancelados: parametros.get('cancelados') === 'no',
    };
}

function guardarEstadoEnUrl() {
    const f = estado.filtros;
    guardarEnUrl({
        vista: f.vista !== 'dia' ? f.vista : null,
        fecha: f.fecha !== hoyISO() ? f.fecha : null,
        profesional: f.profesional,
        cancelados: f.ocultarCancelados ? 'no' : null,
    });
}

// ------------------------------------------------------------
// Período: un día o la semana (lunes a domingo) que contiene a la fecha
// ------------------------------------------------------------
function lunesDe(fecha) {
    const diaSemana = (aFecha(fecha).getDay() + 6) % 7;   // lunes = 0
    return sumarDias(fecha, -diaSemana);
}

function diasDelPeriodo() {
    const { vista, fecha } = estado.filtros;
    if (vista === 'dia') {
        return [fecha];
    }
    const lunes = lunesDe(fecha);
    return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

const FORMATO_DIA_MES = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' });

// "Hoy, miércoles 14 de octubre" / "Semana del 12 al 18 de octubre"
function textoPeriodo(dias) {
    if (dias.length === 1) {
        const dia = diaEnTexto(dias[0]);
        if (dias[0] === hoyISO()) {
            return `Hoy, ${dia}`;
        }
        if (dias[0] === sumarDias(hoyISO(), 1)) {
            return `Mañana, ${dia}`;
        }
        return conMayuscula(dia);
    }
    const [inicio, fin] = [aFecha(dias[0]), aFecha(dias[6])];
    const desde = inicio.getMonth() === fin.getMonth() ? String(inicio.getDate()) : FORMATO_DIA_MES.format(inicio);
    return `Semana del ${desde} al ${FORMATO_DIA_MES.format(fin)}`;
}

// ------------------------------------------------------------
// Presentación
// ------------------------------------------------------------
const deTodos = () => !esProfesional(estado.usuario);

const cantidadTurnos = (n) => (n === 1 ? '1 turno' : `${n} turnos`);

function botonAgendar(fecha, { enlace = false } = {}) {
    const sePuede = fecha >= hoyISO() && fecha <= fechaMaximaTurno() && tienePermiso(estado.usuario, PERMISO.TURNOS_EDITAR);
    if (!sePuede) {
        return null;
    }
    return html`<button type="button" class="eg-btn ${enlace ? 'eg-btn--link' : ''}"
            data-accion="agendar" data-fecha="${fecha}" aria-label="Agendar un turno el ${diaEnTexto(fecha)}">
        ${icono('add_circle')}Agendar${enlace ? '' : ' un turno'}</button>`;
}

const conProfesional = () => deTodos() && !estado.filtros.profesional;

function mensajeVacio(fecha) {
    const pasado = fecha < hoyISO();
    if (deTodos()) {
        return pasado ? 'No hubo turnos ese día.' : 'No hay turnos ese día.';
    }
    return pasado ? 'No tuviste turnos ese día.' : 'No tenés turnos ese día.';
}

function vistaDia(fecha, lista, proxima) {
    if (lista.length === 0) {
        return bloqueVacio(mensajeVacio(fecha), 'event_busy', botonAgendar(fecha));
    }
    return html`<div class="eg-card__body">${listaTurnos(lista, { proxima, conProfesional: conProfesional() })}</div>`;
}

const FORMATO_DIA_SEMANA = new Intl.DateTimeFormat('es-AR', { weekday: 'long' });

// La semana: una columna por día. Cada turno es un botón que abre ese día (ahí están sus acciones).
function vistaSemana(dias, lista, proxima) {
    return html`
        <div class="eg-week">${dias.map((fecha) => {
            const delDia = lista.filter((t) => t.fecha === fecha);
            const esHoy = fecha === hoyISO();
            const nombreDia = FORMATO_DIA_SEMANA.format(aFecha(fecha));
            return html`
                <section class="eg-week__day${esHoy ? ' is-today' : ''}" aria-label="${diaEnTexto(fecha)}${esHoy ? ' (hoy)' : ''}">
                    <h3 class="eg-week__head">
                        <span class="eg-week__name">${nombreDia.charAt(0).toUpperCase()}${nombreDia.slice(1)}${esHoy ? ' · Hoy' : ''}</span>
                        <span class="eg-week__num">${aFecha(fecha).getDate()}</span>
                    </h3>
                    ${delDia.map((t) => html`
                        <button type="button" class="eg-slot ${claseTurno(t, { esProxima: t === proxima })}" data-ir-a-dia="${fecha}"
                                aria-label="${formatearHora(t.hora)}, ${nombrePaciente(t)}, ${t.estado?.nombre ?? t.estado?.Estado ?? ''}. Ver el día">
                            <span class="eg-slot__time">${formatearHora(t.hora)}</span>
                            <span class="eg-slot__name">${nombrePaciente(t, { apellidoPrimero: true })}</span>
                            <span class="eg-slot__estado">${t === proxima ? 'Próxima · ' : ''}${t.estado?.nombre ?? t.estado?.Estado ?? ''}${conProfesional() ? ` · ${nombreProfesional(t)}` : ''}</span>
                        </button>`)}
                    ${delDia.length === 0 && html`<span class="eg-week__empty">Sin turnos</span>`}
                    ${botonAgendar(fecha, { enlace: true })}
                </section>`;
        })}</div>`;
}

// silencioso: sin el "cargando" (para la actualización automática con la hora)
async function mostrarTurnos({ silencioso = false } = {}) {
    const pedido = ++estado.pedido;
    const { vista, profesional, ocultarCancelados } = estado.filtros;
    const dias = diasDelPeriodo();
    const esDia = vista === 'dia';

    $('periodo-texto').textContent = textoPeriodo(dias);
    $('btn-anterior-texto').textContent = esDia ? 'Día anterior' : 'Semana anterior';
    $('btn-siguiente-texto').textContent = esDia ? 'Día siguiente' : 'Semana siguiente';
    $('btn-hoy').disabled = dias.includes(hoyISO());
    guardarEstadoEnUrl();
    if (!silencioso) {
        renderizar($('turnos-cuerpo'), bloqueCargando(3));
    }

    try {
        const todos = await obtenerTurnos();
        if (pedido !== estado.pedido) {
            return;
        }
        const lista = todos
            .filter((t) => dias.includes(t.fecha))
            .filter((t) => !profesional || t.profesional_id === profesional)
            .filter((t) => !ocultarCancelados || !estaCancelado(t));
        const proxima = proximaDeHoy(lista);
        $('turnos-total').textContent = cantidadTurnos(lista.length);
        renderizar($('turnos-cuerpo'), esDia ? vistaDia(dias[0], lista, proxima) : vistaSemana(dias, lista, proxima));
    } catch (error) {
        if (pedido !== estado.pedido) {
            return;
        }
        $('turnos-total').textContent = '';
        mostrarError($('turnos-cuerpo'), error, () => mostrarTurnos());
    }
}

// ------------------------------------------------------------
// Eventos
// ------------------------------------------------------------
function cambiarPeriodo(paso) {
    const f = estado.filtros;
    f.fecha = paso === 0 ? hoyISO() : sumarDias(f.fecha, paso * (f.vista === 'dia' ? 1 : 7));
    mostrarTurnos();
}

async function prepararFiltroProfesional() {
    if (!deTodos()) {
        return;
    }
    $('filtro-profesional-campo').hidden = false;
    const select = $('filtro-profesional');
    try {
        const lista = await profesionales.listar();
        lista
            .slice()
            .sort((a, b) => nombreCompleto(a, { apellidoPrimero: true }).localeCompare(nombreCompleto(b, { apellidoPrimero: true }), 'es'))
            .forEach((p) => select.append(new Option(nombreCompleto(p, { apellidoPrimero: true }), p.id_profesional)));
        select.value = estado.filtros.profesional ?? '';
    } catch {
        // Sin la lista no se puede filtrar: se muestran los de todos
        $('filtro-profesional-campo').hidden = true;
        estado.filtros.profesional = null;
    }
}

function prepararEventos() {
    const f = estado.filtros;
    $(f.vista === 'semana' ? 'vista-semana' : 'vista-dia').checked = true;
    $('filtro-cancelados').checked = f.ocultarCancelados;

    $('filtros-turnos').addEventListener('submit', (evento) => evento.preventDefault());
    document.querySelectorAll('[name="vista"]').forEach((opcion) => opcion.addEventListener('change', () => {
        f.vista = opcion.value;
        mostrarTurnos();
    }));
    $('filtro-profesional').addEventListener('change', (evento) => {
        f.profesional = enteroDeUrl(evento.target.value);
        mostrarTurnos();
    });
    $('filtro-cancelados').addEventListener('change', (evento) => {
        f.ocultarCancelados = evento.target.checked;
        mostrarTurnos();
    });
    $('btn-anterior').addEventListener('click', () => cambiarPeriodo(-1));
    $('btn-siguiente').addEventListener('click', () => cambiarPeriodo(1));
    $('btn-hoy').addEventListener('click', () => cambiarPeriodo(0));
    $('turnos-cuerpo').addEventListener('click', (evento) => {
        const turno = evento.target.closest('[data-ir-a-dia]');
        if (turno) {
            irADia(turno.dataset.irADia);
        }
    });
}

function prepararAcciones() {
    estado.acciones = prepararTurnos({
        usuario: estado.usuario,
        alCambiar: mostrarTurnos,
        focoTrasCambio: () => $('periodo-titulo'),
    });
    estado.acciones.escuchar($('turnos-cuerpo'));

    const botonPendientes = $('btn-sesiones-pendientes');
    if (botonPendientes && (esProfesional(estado.usuario) || tienePermiso(estado.usuario, PERMISO.SESIONES_REGISTRAR))) {
        botonPendientes.hidden = false;
        botonPendientes.addEventListener('click', () => {
            estado.acciones.abrirPendientes();
        });
    }

    if (!tienePermiso(estado.usuario, PERMISO.TURNOS_EDITAR)) {
        return;
    }
    const boton = $('btn-nuevo-turno');
    boton.hidden = false;
    boton.addEventListener('click', () => {
        const fecha = estado.filtros.vista === 'dia' ? estado.filtros.fecha : null;
        estado.acciones.abrirNuevo({ fecha });
    });
    $('turnos-cuerpo').addEventListener('click', (evento) => {
        const agendar = evento.target.closest('[data-accion="agendar"]');
        if (agendar) {
            estado.acciones.abrirNuevo({ fecha: agendar.dataset.fecha });
        }
    });
}

// Semana: tocar un turno abre ese día, con las acciones de cada turno
async function irADia(fecha) {
    estado.filtros.vista = 'dia';
    estado.filtros.fecha = fecha;
    $('vista-dia').checked = true;
    await mostrarTurnos();
    $('periodo-titulo').tabIndex = -1;
    $('periodo-titulo').focus();
}

// ------------------------------------------------------------
// Inicio
// ------------------------------------------------------------
async function iniciar() {
    prepararEventos();

    try {
        estado.usuario = await obtenerUsuario();
    } catch (error) {
        // 401: api.js ya redirige al login
        if (error.status !== 401) {
            mostrarError($('turnos-cuerpo'), error, () => window.location.reload());
        }
        return;
    }

    if (!tienePermiso(estado.usuario, PERMISO.TURNOS_VER)) {
        $('turnos-subtitulo').textContent = '';
        renderizar($('turnos-cuerpo'), bloqueVacio('No tenés acceso a los turnos.', 'lock'));
        return;
    }

    $('turnos-subtitulo').textContent = deTodos() ? 'Turnos de todos los profesionales' : 'Tus turnos';
    prepararAcciones();
    await prepararFiltroProfesional();
    mostrarTurnos();
    // Con la pantalla abierta, se actualiza sola cuando un turno empieza o termina
    actualizarConLaHora({
        zonas: () => [$('turnos-cuerpo')],
        redibujar: () => mostrarTurnos({ silencioso: true }),
    });
}

iniciar();
