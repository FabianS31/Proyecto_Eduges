// ============================================================
// EduGes - Inicio (templates/index.html)
//
// Profesional → su dashboard: agenda del día (con reprogramar y cancelar),
// próxima sesión, CUD por vencer, buscador de sus pacientes y alta rápida
// de turnos (una fecha o varias) y pacientes.
// Resto de los usuarios → resumen general (cuenta, profesionales, accesos).
//
// Endpoints: /api/auth/me/, /api/profesionales/, /api/pacientes/ y /api/turnos/.
// Los turnos (datos, lista y modales) los maneja componentes/turnos.js.
// "Sesiones sin registrar" queda oculto hasta que exista la API de sesiones.
// Cada bloque carga y falla por separado.
// ============================================================

import { crearCombobox } from '../componentes/combobox.js';
import { prepararFormularioPaciente } from '../componentes/formulario-paciente.js';
import {
    badgeEstadoTurno,
    diaEnTexto,
    estaActivo,
    fechaMaximaTurno,
    formatearHora,
    itemTurno,
    mensajeSinPacientes,
    nombrePaciente,
    obtenerTurnos,
    prepararTurnos,
    sugerirPacientes,
    urlPaciente,
    yaEmpezo,
} from '../componentes/turnos.js';
import { DIAS_AVISO_CUD, ESTADO_TURNO, PERMISO } from '../constantes.js';
import { pacientes, profesionales } from '../endpoints.js';
import { diasEntre, hoyISO, sumarDias } from '../fechas.js';
import { esProfesional, obtenerUsuario, tienePermiso } from '../layout.js';
import {
    badgeCud,
    bloqueCargando,
    bloqueVacio,
    CUD,
    estadoCud,
    formatearFechaLarga,
    html,
    mostrarError,
    nombreCompleto,
    renderizar,
} from '../ui.js';

const $ = (id) => document.getElementById(id);

const estado = {
    usuario: null,
    fecha: hoyISO(),          // día que muestra la agenda
    pedidoAgenda: 0,          // si se cambia de día rápido, solo se muestra la última respuesta
    acciones: null,           // nuevo turno, reprogramar y cancelar (componentes/turnos.js)
};

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
function saludo() {
    const hora = new Date().getHours();
    if (hora < 13) {
        return 'Buen día';
    }
    return hora < 20 ? 'Buenas tardes' : 'Buenas noches';
}

// "Mi agenda de hoy" / "de mañana" / "del lunes 5 de octubre"
function textoDia(fecha) {
    const diferencia = diasEntre(hoyISO(), fecha);
    if (diferencia === 0) {
        return { titulo: 'Mi agenda de hoy', vacio: 'No tenés sesiones hoy.' };
    }
    if (diferencia === 1) {
        return { titulo: 'Mi agenda de mañana', vacio: 'No tenés sesiones mañana.' };
    }
    if (diferencia === -1) {
        return { titulo: 'Mi agenda de ayer', vacio: 'No tuviste sesiones ayer.' };
    }
    const dia = diaEnTexto(fecha);
    return {
        titulo: `Mi agenda del ${dia}`,
        vacio: diferencia < 0 ? `No tuviste sesiones el ${dia}.` : `No tenés sesiones el ${dia}.`,
    };
}

// ------------------------------------------------------------
// Vista general (sin profesional asociado)
// ------------------------------------------------------------
async function mostrarVistaGeneral(usuario) {
    $('vista-general').hidden = false;
    const especialidad = usuario.profesional?.especialidad?.nombre;
    renderizar($('inicio-cuenta'), html`
        <div class="col-6"><dt>Usuario</dt><dd><code>${usuario.usuario}</code></dd></div>
        <div class="col-6"><dt>Rol</dt><dd>${usuario.rol?.nombre ?? '—'}</dd></div>
        ${especialidad && html`<div class="col-12"><dt>Especialidad</dt><dd>${especialidad}</dd></div>`}`);

    if (!tienePermiso(usuario, PERMISO.PROFESIONALES_VER)) {
        return;
    }
    const contenedor = $('inicio-profesionales');
    try {
        contenedor.textContent = (await profesionales.listar()).length;
    } catch (error) {
        if (error.status !== 401) {
            renderizar(contenedor, html`<span class="text-muted fs-6 fw-normal" title="${error.message}">No disponible</span>`);
        }
    }
}

// ------------------------------------------------------------
// Dashboard del profesional: bloques
// ------------------------------------------------------------
function vacioConAccion(mensaje, icono, accion) {
    return html`
        <div class="text-center text-muted py-4 px-3">
            <i class="bi ${icono} fs-3 d-block mb-2 text-secondary" aria-hidden="true"></i>
            <p class="mb-0">${mensaje}</p>
            ${accion}
        </div>`;
}

function botonAgendar(fecha) {
    const sePuede = fecha >= hoyISO() && fecha <= fechaMaximaTurno();
    return sePuede && tienePermiso(estado.usuario, PERMISO.TURNOS_EDITAR)
        ? html`<button type="button" class="btn btn-sm btn-outline-primary mt-3" data-accion="agendar">
                <i class="bi bi-calendar-plus me-1" aria-hidden="true"></i>Agendar un turno</button>`
        : null;
}

// La próxima sesión de hoy que todavía no empezó (pendiente o confirmada)
function proximaSesion(turnosDeHoy) {
    return turnosDeHoy.find((t) => estaActivo(t) && !yaEmpezo(t)) ?? null;
}

function mostrarProxima(turnosDeHoy) {
    const turno = proximaSesion(turnosDeHoy);
    if (!turno) {
        renderizar($('proxima-cuerpo'), bloqueVacio('No tenés más sesiones por hoy.', 'bi-cup-hot'));
        return;
    }
    const paciente = nombrePaciente(turno);
    renderizar($('proxima-cuerpo'), html`
        <div class="p-3">
            <div class="d-flex align-items-baseline gap-2 mb-1">
                <span class="dashboard-hora-grande">${formatearHora(turno.hora)}</span>
                ${badgeEstadoTurno(turno.estado)}
            </div>
            <div class="fw-semibold fs-6 ${turno.paciente ? 'mb-3' : ''}">${paciente}</div>
            ${turno.paciente && html`
                <a href="${urlPaciente(turno.paciente_id)}" class="btn btn-sm btn-eduges">
                    <i class="bi bi-person-lines-fill me-1" aria-hidden="true"></i>Ver ficha de ${paciente}
                </a>`}
        </div>`);
}

function mostrarMetricaHoy(turnosDeHoy) {
    const activos = turnosDeHoy.filter((t) => t.estado !== ESTADO_TURNO.CANCELADO);
    const porAtender = turnosDeHoy.filter((t) => estaActivo(t) && !yaEmpezo(t));
    $('metrica-hoy').textContent = activos.length;
    $('metrica-hoy-detalle').textContent = activos.length === 0
        ? 'Sin sesiones agendadas'
        : `${porAtender.length} por atender`;
}

// Agenda del día elegido + próxima sesión y número de hoy (que siempre son de hoy)
async function cargarAgenda() {
    const pedido = ++estado.pedidoAgenda;
    const fecha = estado.fecha;
    const esHoy = fecha === hoyISO();
    const textos = textoDia(fecha);

    $('agenda-titulo-texto').textContent = textos.titulo;
    $('btn-dia-hoy').disabled = esHoy;
    $('btn-dia-hoy').setAttribute('aria-pressed', esHoy ? 'true' : 'false');
    renderizar($('agenda-cuerpo'), bloqueCargando(3));

    try {
        const lista = await obtenerTurnos();
        if (pedido !== estado.pedidoAgenda) {
            return;
        }
        const delDia = lista.filter((t) => t.fecha === fecha);
        const deHoy = lista.filter((t) => t.fecha === hoyISO());
        renderizar($('agenda-cuerpo'), delDia.length > 0
            ? html`<ul class="list-group list-group-flush">${delDia.map((t) => itemTurno(t))}</ul>`
            : vacioConAccion(textos.vacio, 'bi-calendar-x', botonAgendar(fecha)));
        mostrarProxima(deHoy);
        mostrarMetricaHoy(deHoy);
    } catch (error) {
        if (pedido !== estado.pedidoAgenda) {
            return;
        }
        mostrarError($('agenda-cuerpo'), error, cargarAgenda);
        mostrarError($('proxima-cuerpo'), error, cargarAgenda);
        $('metrica-hoy').textContent = '—';
        $('metrica-hoy-detalle').textContent = '';
    }
}

function cambiarDia(dias) {
    estado.fecha = dias === 0 ? hoyISO() : sumarDias(estado.fecha, dias);
    cargarAgenda();
}

async function cargarCud() {
    renderizar($('cud-cuerpo'), bloqueCargando(2));
    try {
        // Vencidos y por vencer, el más urgente primero
        const lista = (await pacientes.listar())
            .map((p) => ({ ...p, cud: estadoCud(p.cud_vencimiento) }))
            .filter((p) => p.cud.clave !== CUD.VIGENTE)
            .sort((a, b) => a.cud.dias - b.cud.dias);
        $('metrica-cud').textContent = lista.length;
        renderizar($('cud-cuerpo'), lista.length > 0
            ? html`<ul class="list-group list-group-flush">${lista.map((p) => html`
                <li class="list-group-item d-flex justify-content-between align-items-center gap-2 py-3">
                    <a href="${urlPaciente(p.id_paciente)}" class="fw-semibold text-dark text-decoration-none">${nombreCompleto(p, { apellidoPrimero: true })}</a>
                    ${badgeCud(p.cud_vencimiento)}
                </li>`)}</ul>`
            : bloqueVacio(`Ningún CUD de tus pacientes vence en los próximos ${DIAS_AVISO_CUD} días.`, 'bi-shield-check'));
    } catch (error) {
        $('metrica-cud').textContent = '—';
        // Reintentar vuelve a pedir los pacientes para los bloques que los usan
        mostrarError($('cud-cuerpo'), error, refrescarDashboard);
    }
}

async function cargarCantidadPacientes() {
    try {
        $('metrica-pacientes').textContent = (await pacientes.listar()).length;
    } catch {
        $('metrica-pacientes').textContent = '—';
    }
}

// ------------------------------------------------------------
// Dashboard del profesional: armado
// ------------------------------------------------------------
// Devuelve una Promise que termina cuando la agenda y los pacientes se volvieron a mostrar
function refrescarDashboard() {
    return Promise.all([cargarAgenda(), cargarCud(), cargarCantidadPacientes()]);
}

function mostrarDashboardProfesional() {
    $('vista-profesional').hidden = false;
    $('acciones-profesional').hidden = false;

    estado.acciones = prepararTurnos({
        usuario: estado.usuario,
        alCambiar: refrescarDashboard,
        focoTrasCambio: () => $('agenda-titulo'),
    });
    crearCombobox($('buscar-paciente'), {
        buscar: sugerirPacientes,
        minimo: 1,
        mensajeVacio: mensajeSinPacientes(),
        alElegir: (opcion) => opcion && window.location.assign(urlPaciente(opcion.valor)),
    });
    const abrirNuevoPaciente = prepararFormularioPaciente({ alGuardar: refrescarDashboard });

    $('btn-dia-anterior').addEventListener('click', () => cambiarDia(-1));
    $('btn-dia-siguiente').addEventListener('click', () => cambiarDia(1));
    $('btn-dia-hoy').addEventListener('click', () => cambiarDia(0));
    $('btn-nuevo-turno').addEventListener('click', () => estado.acciones.abrirNuevo());
    $('btn-nuevo-paciente').addEventListener('click', abrirNuevoPaciente);
    estado.acciones.escuchar($('agenda-cuerpo'));
    $('agenda-cuerpo').addEventListener('click', (evento) => {
        if (evento.target.closest('[data-accion="agendar"]')) {
            estado.acciones.abrirNuevo({ fecha: estado.fecha });
        }
    });

    refrescarDashboard();
}

// ------------------------------------------------------------
// Inicio
// ------------------------------------------------------------
async function iniciar() {
    $('inicio-fecha').textContent = formatearFechaLarga(hoyISO());

    try {
        estado.usuario = await obtenerUsuario();
    } catch (error) {
        // 401: api.js ya redirigió al login. Si no, se explica qué pasó y se ofrece reintentar
        // (sin los datos de la sesión no se sabe qué mostrar).
        $('inicio-saludo').textContent = 'Inicio';
        if (error.status !== 401) {
            mostrarError($('inicio-error'), error, () => window.location.reload());
        }
        return;
    }

    const usuario = estado.usuario;
    $('inicio-saludo').textContent = `${saludo()}, ${usuario.profesional?.nombre ?? usuario.usuario}`;

    if (esProfesional(usuario)) {
        mostrarDashboardProfesional();
    } else {
        mostrarVistaGeneral(usuario);
    }
}

iniciar();
