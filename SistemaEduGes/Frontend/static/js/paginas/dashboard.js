// ============================================================
// EduGes - Inicio (templates/index.html)
//
// Profesional → su dashboard: resumen del día, buscador de sus pacientes,
// números clave, agenda del día (con las acciones de cada turno), próxima sesión,
// CUD por vencer y alta rápida de turnos (una fecha o varias) y pacientes.
// Administración → el día de todo el centro (turnos de hoy, los que faltan confirmar,
// CUD a vencer, profesionales) y nuevo turno. Sin permiso para ver turnos: su cuenta y accesos.
//
// Endpoints: /api/auth/me/, /api/profesionales/, /api/pacientes/ y /api/turnos/.
// Los turnos (datos, lista y modales) los maneja componentes/turnos.js.
// "Sesiones sin registrar" se agrega cuando exista la API de sesiones.
// Cada bloque carga y falla por separado.
// ============================================================

import { crearCombobox } from '../componentes/combobox.js';
import { prepararFormularioPaciente } from '../componentes/formulario-paciente.js?v=20261022_1';
import {
    actualizarConLaHora,
    badgeEstadoTurno,
    diaEnTexto,
    estaActivo,
    estaCancelado,
    fechaMaximaTurno,
    formatearHora,
    listaTurnos,
    mensajeSinPacientes,
    nombrePaciente,
    obtenerTurnos,
    prepararTurnos,
    proximaDeHoy,
    sugerirPacientes,
    urlPaciente,
    yaEmpezo,
} from '../componentes/turnos.js';
import { ESTADO_TURNO, MESES_AVISO_CUD, PERMISO, TURNO_DURACION_MINUTOS } from '../constantes.js';
import { pacientes, profesionales } from '../endpoints.js';
import { diasEntre, hoyISO, sumarDias } from '../fechas.js';
import { esProfesional, obtenerUsuario, tienePermiso } from '../layout.js';
import {
    bloqueCargando,
    bloqueVacio,
    CUD,
    estadoCud,
    formatearFechaLarga,
    html,
    icono,
    iniciales,
    mostrarError,
    nombreCompleto,
    renderizar,
} from '../ui.js';

const $ = (id) => document.getElementById(id);

const estado = {
    usuario: null,
    fecha: hoyISO(),          // día que muestra la agenda
    pedidoAgenda: 0,          // si se cambia de día rápido, solo se muestra la última respuesta
    proxima: null,            // próxima sesión de hoy (su "en 25 min" se actualiza cada minuto)
    acciones: null,           // nuevo turno, reprogramar, cancelar y estados (componentes/turnos.js)
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

const plural = (n, singular, varios) => `${n} ${n === 1 ? singular : varios}`;

// Minutos que faltan para un turno de hoy: "en 25 min", "en 1 h 10 min"
function textoFalta(turno) {
    const [h, m] = formatearHora(turno.hora).split(':').map(Number);
    const ahora = new Date();
    const minutos = h * 60 + m - (ahora.getHours() * 60 + ahora.getMinutes());
    if (minutos < 60) {
        return `en ${minutos} min`;
    }
    const horas = Math.floor(minutos / 60);
    return minutos % 60 === 0 ? `en ${horas} h` : `en ${horas} h ${minutos % 60} min`;
}

// "10:30 – 11:30"
function rangoHorario(turno) {
    const [h, m] = formatearHora(turno.hora).split(':').map(Number);
    const fin = h * 60 + m + TURNO_DURACION_MINUTOS;
    return `${formatearHora(turno.hora)} – ${String(Math.floor(fin / 60) % 24).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`;
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
    if (tienePermiso(usuario, PERMISO.TURNOS_VER)) {
        mostrarCentro();
        return;
    }
    const especialidad = usuario.profesional?.especialidad?.nombre;
    renderizar($('inicio-cuenta'), html`
        <div class="col-12 col-sm-6"><dt>Usuario</dt><dd>${usuario.usuario}</dd></div>
        <div class="col-12 col-sm-6"><dt>Rol</dt><dd>${usuario.rol?.nombre ?? '—'}</dd></div>
        ${especialidad && html`<div class="col-12"><dt>Especialidad</dt><dd>${especialidad}</dd></div>`}`);

    if (!tienePermiso(usuario, PERMISO.PROFESIONALES_EDITAR)) {
        return;
    }
    const contenedor = $('inicio-profesionales');
    try {
        contenedor.textContent = (await profesionales.listar()).length;
    } catch (error) {
        if (error.status !== 401) {
            renderizar(contenedor, html`<span class="eg-stat__sub" title="${error.message}">No disponible</span>`);
        }
    }
}

// ------------------------------------------------------------
// Administración: el día de todo el centro
// ------------------------------------------------------------
const MAXIMO_SIN_CONFIRMAR = 8;

// "Hoy hay 12 turnos en el centro y 3 todavía sin confirmar."
function resumenCentro(deHoy, sinConfirmar) {
    const activos = deHoy.filter((t) => !estaCancelado(t));
    const partes = activos.length === 0
        ? html`Hoy no hay turnos agendados en el centro`
        : html`Hoy hay <b>${plural(activos.length, 'turno', 'turnos')}</b> en el centro`;
    renderizar($('inicio-lead'), sinConfirmar.length > 0
        ? html`${partes} y <b>${sinConfirmar.length}</b> todavía sin confirmar (hoy y mañana).`
        : html`${partes}. No hay turnos sin confirmar para hoy ni mañana.`);
}

async function cargarCentro({ silencioso = false } = {}) {
    if (!silencioso) {
        renderizar($('centro-agenda'), bloqueCargando(3));
        renderizar($('centro-confirmar'), bloqueCargando(2));
    }
    try {
        const lista = await obtenerTurnos();
        const manana = sumarDias(hoyISO(), 1);
        const deHoy = lista.filter((t) => t.fecha === hoyISO());
        const sinConfirmar = lista.filter((t) => (t.fecha === hoyISO() || t.fecha === manana)
            && (t.estado?.id ?? t.estado?.ID_EstadoTurno) === ESTADO_TURNO.PENDIENTE);
        const proxima = proximaDeHoy(lista);

        const activos = deHoy.filter((t) => !estaCancelado(t));
        const realizados = deHoy.filter((t) => (t.estado?.id ?? t.estado?.ID_EstadoTurno) === ESTADO_TURNO.REALIZADO).length;
        const porAtender = deHoy.filter((t) => estaActivo(t) && !yaEmpezo(t)).length;
        $('centro-hoy').textContent = activos.length;
        $('centro-hoy-detalle').textContent = activos.length === 0
            ? 'Sin turnos agendados'
            : [realizados > 0 && plural(realizados, 'realizado', 'realizados'), `${porAtender} por atender`].filter(Boolean).join(' · ');
        $('centro-pendientes').textContent = sinConfirmar.length;
        resumenCentro(deHoy, sinConfirmar);

        renderizar($('centro-agenda'), deHoy.length > 0
            ? listaTurnos(deHoy, { proxima, conProfesional: true })
            : bloqueVacio('Hoy no hay turnos en el centro.', 'event_busy'));

        const mostrados = sinConfirmar.slice(0, MAXIMO_SIN_CONFIRMAR);
        renderizar($('centro-confirmar'), sinConfirmar.length > 0
            ? html`
                ${listaTurnos(mostrados, { conProfesional: true, conDia: true })}
                ${sinConfirmar.length > mostrados.length && html`
                    <p class="eg-card__nota px-3 pt-2 mb-0">Y ${sinConfirmar.length - mostrados.length} más: están en la agenda.</p>`}`
            : bloqueVacio('Todos los turnos de hoy y mañana están confirmados.', 'task_alt'));
    } catch (error) {
        mostrarError($('centro-agenda'), error, () => cargarCentro());
        mostrarError($('centro-confirmar'), error, () => cargarCentro());
        $('centro-hoy').textContent = '—';
        $('centro-pendientes').textContent = '—';
    }
}

async function cargarNumerosCentro() {
    const [listaPacientes, listaProfesionales] = await Promise.all([
        tienePermiso(estado.usuario, PERMISO.PACIENTES_VER) ? pacientes.listar().catch(() => null) : null,
        tienePermiso(estado.usuario, PERMISO.PROFESIONALES_EDITAR) ? profesionales.listar().catch(() => null) : null,
    ]);
    $('centro-cud').textContent = listaPacientes
        ? listaPacientes.filter((p) => estadoCud(p.cud_vencimiento).clave !== CUD.VIGENTE).length
        : '—';
    $('centro-profesionales').textContent = listaProfesionales ? listaProfesionales.length : '—';
}

function mostrarCentro() {
    $('centro').hidden = false;
    $('general-basico').hidden = true;

    estado.acciones = prepararTurnos({
        usuario: estado.usuario,
        alCambiar: () => Promise.all([cargarCentro(), cargarNumerosCentro()]),
        focoTrasCambio: () => $('centro-agenda-titulo'),
    });
    estado.acciones.escuchar($('centro-agenda'));
    estado.acciones.escuchar($('centro-confirmar'));
    if (tienePermiso(estado.usuario, PERMISO.TURNOS_EDITAR)) {
        $('acciones-profesional').hidden = false;
        $('btn-nuevo-paciente').hidden = true;
        $('btn-nuevo-turno').addEventListener('click', () => estado.acciones.abrirNuevo());
    }
    // "Ver cuáles" baja hasta los turnos sin confirmar y deja el foco ahí
    document.querySelector('a[href="#centro-confirmar-titulo"]').addEventListener('click', (evento) => {
        evento.preventDefault();
        $('centro-confirmar-titulo').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('centro-confirmar-titulo').focus({ preventScroll: true });
    });

    cargarCentro();
    cargarNumerosCentro();
    // Con la pantalla abierta: se actualiza sola cuando un turno empieza o termina
    actualizarConLaHora({
        zonas: () => [$('centro-agenda'), $('centro-confirmar'), $('inicio-lead')],
        redibujar: () => cargarCentro({ silencioso: true }),
    });
}

// ------------------------------------------------------------
// Dashboard del profesional: bloques
// ------------------------------------------------------------
function botonAgendar(fecha) {
    const sePuede = fecha >= hoyISO() && fecha <= fechaMaximaTurno();
    return sePuede && tienePermiso(estado.usuario, PERMISO.TURNOS_EDITAR)
        ? html`<button type="button" class="eg-btn" data-accion="agendar">${icono('add_circle')}Agendar un turno</button>`
        : null;
}

// "Hoy tenés 4 sesiones agendadas. La próxima es a las 10:30."
function mostrarResumen(turnosDeHoy, proxima) {
    const activos = turnosDeHoy.filter((t) => !estaCancelado(t));
    let texto;
    if (activos.length === 0) {
        texto = html`Hoy no tenés sesiones agendadas.`;
    } else if (proxima) {
        texto = html`Hoy tenés <b>${plural(activos.length, 'sesión agendada', 'sesiones agendadas')}</b>. La próxima es a las <b>${formatearHora(proxima.hora)}</b>.`;
    } else {
        texto = html`Hoy tenés <b>${plural(activos.length, 'sesión agendada', 'sesiones agendadas')}</b> y ya no te quedan más por atender.`;
    }
    renderizar($('inicio-lead'), texto);
}

function mostrarProxima(turno) {
    estado.proxima = turno;
    if (!turno) {
        renderizar($('proxima-cuando'), '');
        renderizar($('proxima-cuerpo'), html`
            <p class="eg-next__vacio">${icono('coffee')}No tenés más sesiones por hoy.</p>`);
        return;
    }
    const paciente = nombrePaciente(turno);
    const puedeReprogramar = tienePermiso(estado.usuario, PERMISO.TURNOS_EDITAR) && estaActivo(turno);
    renderizar($('proxima-cuando'), html`<span class="eg-chip eg-chip--dark">${textoFalta(turno)}</span>`);
    renderizar($('proxima-cuerpo'), html`
        <div class="eg-next__who">
            <div class="eg-avatar eg-avatar--lg eg-avatar--blue" aria-hidden="true">${iniciales(turno.paciente)}</div>
            <div>
                <span class="eg-next__name">${paciente}</span>
                <span class="eg-next__when">${rangoHorario(turno)}</span>
            </div>
        </div>
        <div>${badgeEstadoTurno(turno.estado)}</div>
        <div class="eg-next__actions">
            ${turno.paciente && html`
                <a href="${urlPaciente(turno.paciente_id)}" class="eg-btn eg-btn--white">${icono('folder_open')}Abrir ficha</a>`}
            ${puedeReprogramar && html`
                <button type="button" class="eg-btn eg-btn--outline-light" data-accion="reprogramar" data-turno="${turno.id_turno}"
                        aria-label="Reprogramar el turno de ${paciente} de las ${formatearHora(turno.hora)}">
                    ${icono('event_repeat')}Reprogramar
                </button>`}
        </div>`);
}

// "1 realizada · 3 por atender"
function mostrarMetricaHoy(turnosDeHoy) {
    const activos = turnosDeHoy.filter((t) => !estaCancelado(t));
    const realizadas = turnosDeHoy.filter((t) => (t.estado?.id ?? t.estado?.ID_EstadoTurno) === ESTADO_TURNO.REALIZADO).length;
    const porAtender = turnosDeHoy.filter((t) => estaActivo(t) && !yaEmpezo(t)).length;
    $('metrica-hoy').textContent = activos.length;
    $('metrica-hoy-detalle').textContent = activos.length === 0
        ? 'Sin sesiones agendadas'
        : [realizadas > 0 && plural(realizadas, 'realizada', 'realizadas'), `${porAtender} por atender`].filter(Boolean).join(' · ');
}

// Agenda del día elegido + resumen, próxima sesión y número de hoy (que siempre son de hoy).
// silencioso: sin el "cargando" (para la actualización automática con la hora)
async function cargarAgenda({ silencioso = false } = {}) {
    const pedido = ++estado.pedidoAgenda;
    const fecha = estado.fecha;
    const esHoy = fecha === hoyISO();
    const textos = textoDia(fecha);

    $('agenda-titulo-texto').textContent = textos.titulo;
    $('btn-dia-hoy').disabled = esHoy;
    $('btn-dia-hoy').setAttribute('aria-pressed', esHoy ? 'true' : 'false');
    if (!silencioso) {
        renderizar($('agenda-cuerpo'), bloqueCargando(3));
    }

    try {
        const lista = await obtenerTurnos();
        if (pedido !== estado.pedidoAgenda) {
            return;
        }
        const delDia = lista.filter((t) => t.fecha === fecha);
        const deHoy = lista.filter((t) => t.fecha === hoyISO());
        const proxima = proximaDeHoy(lista);
        renderizar($('agenda-cuerpo'), delDia.length > 0
            ? listaTurnos(delDia, { proxima })
            : bloqueVacio(textos.vacio, 'event_busy', botonAgendar(fecha)));
        mostrarResumen(deHoy, proxima);
        mostrarProxima(proxima);
        mostrarMetricaHoy(deHoy);
    } catch (error) {
        if (pedido !== estado.pedidoAgenda) {
            return;
        }
        mostrarError($('agenda-cuerpo'), error, () => cargarAgenda());
        mostrarError($('proxima-cuerpo'), error, () => cargarAgenda());
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
            ? html`<ul class="eg-lista">${lista.map((p) => html`
                <li class="eg-list-item">
                    <div class="eg-avatar" aria-hidden="true">${iniciales(p)}</div>
                    <div class="eg-list-item__text">
                        <a href="${urlPaciente(p.id_paciente)}" class="eg-list-item__title">${nombreCompleto(p)}</a>
                        <span class="eg-list-item__sub">${p.cud.fecha}</span>
                    </div>
                    <span class="eg-chip ${p.cud.clase}">${icono(p.cud.icono)}${p.cud.texto}</span>
                </li>`)}</ul>`
            : bloqueVacio(`Ningún CUD de tus pacientes vence en los próximos ${MESES_AVISO_CUD} meses.`, 'verified_user'));
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
    estado.acciones.escuchar($('proxima-cuerpo'));
    $('agenda-cuerpo').addEventListener('click', (evento) => {
        if (evento.target.closest('[data-accion="agendar"]')) {
            estado.acciones.abrirNuevo({ fecha: estado.fecha });
        }
    });

    // Con la pantalla abierta: la agenda se actualiza sola cuando un turno empieza o termina,
    // y el "en 25 min" de la próxima sesión, cada minuto
    actualizarConLaHora({
        zonas: () => [$('agenda-cuerpo'), $('proxima-cuerpo'), $('inicio-lead')],
        redibujar: () => cargarAgenda({ silencioso: true }),
    });
    setInterval(() => {
        if (estado.proxima) {
            renderizar($('proxima-cuando'), html`<span class="eg-chip eg-chip--dark">${textoFalta(estado.proxima)}</span>`);
        }
    }, 30 * 1000);

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
