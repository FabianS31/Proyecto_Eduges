// ============================================================
// EduGes - Inicio (templates/index.html)
//
// Profesional → su dashboard: agenda del día, próxima sesión, sesiones sin
// registrar, CUD por vencer, buscador de sus pacientes y alta rápida de turnos
// y pacientes.
// Resto de los usuarios → resumen general (cuenta, profesionales, accesos).
//
// Endpoints: /api/auth/me/ y /api/profesionales/ (reales). Pacientes, turnos y
// catálogos todavía no tienen API: endpoints.js devuelve listas vacías y, al
// guardar, un aviso. Cada bloque carga y falla por separado.
// ============================================================

import { buscarEnLista, crearCombobox } from '../componentes/combobox.js';
import { prepararFormularioPaciente } from '../componentes/formulario-paciente.js';
import { guardar, prepararModal } from '../componentes/formularios.js';
import { DIAS_AVISO_CUD, ESTADO_TURNO, PERMISO } from '../constantes.js';
import { pacientes, profesionales, turnos } from '../endpoints.js';
import { aFecha, diasEntre, hoyISO, sumarDias } from '../fechas.js';
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
    agenda: null,             // AbortController de la agenda
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

const urlPaciente = (id) => `/pacientes/?paciente=${encodeURIComponent(id)}`;

// Estado del turno: siempre con ícono y texto, no solo con color
const ESTILO_ESTADO_TURNO = {
    [ESTADO_TURNO.PENDIENTE]: { clase: 'badge-turno-pendiente', icono: 'bi-hourglass-split' },
    [ESTADO_TURNO.CONFIRMADO]: { clase: 'badge-turno-confirmado', icono: 'bi-check2' },
    [ESTADO_TURNO.CANCELADO]: { clase: 'badge-turno-cancelado', icono: 'bi-x-lg' },
    [ESTADO_TURNO.REALIZADO]: { clase: 'badge-turno-realizado', icono: 'bi-check2-all' },
};

function badgeEstadoTurno(estadoTurno) {
    const estilo = ESTILO_ESTADO_TURNO[estadoTurno?.id] ?? { clase: 'bg-secondary', icono: 'bi-question' };
    return html`<span class="badge badge-turno ${estilo.clase}">
        <i class="bi ${estilo.icono} me-1" aria-hidden="true"></i>${estadoTurno?.nombre ?? 'Sin estado'}</span>`;
}

const formatearHora = (hora) => (hora ? hora.slice(0, 5) : '—');

const FORMATO_DIA = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

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
    // "martes 6 de octubre" (sin coma ni año)
    const conMinuscula = FORMATO_DIA.format(aFecha(fecha)).replace(',', '');
    return {
        titulo: `Mi agenda del ${conMinuscula}`,
        vacio: diferencia < 0 ? `No tuviste sesiones el ${conMinuscula}.` : `No tenés sesiones el ${conMinuscula}.`,
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
function itemTurno(turno, { mostrarFecha = false } = {}) {
    const paciente = nombreCompleto(turno.paciente, { apellidoPrimero: true });
    return html`
        <li class="list-group-item d-flex align-items-center gap-3 py-3">
            <div class="dashboard-hora">${formatearHora(turno.hora)}</div>
            <div class="flex-grow-1 min-w-0">
                <a href="${urlPaciente(turno.paciente?.id)}" class="fw-semibold text-dark text-decoration-none d-block text-truncate">${paciente}</a>
                ${mostrarFecha
                    ? html`<span class="small text-muted">${formatearFechaLarga(turno.fecha)}</span>`
                    : badgeEstadoTurno(turno.estado)}
            </div>
            <a href="${urlPaciente(turno.paciente?.id)}" class="btn btn-sm btn-light border text-primary"
               aria-label="Ver ficha de ${paciente}" title="Ver ficha">
                <i class="bi bi-person-lines-fill" aria-hidden="true"></i>
            </a>
        </li>`;
}

function vacioConAccion(mensaje, icono, accion) {
    return html`
        <div class="text-center text-muted py-4 px-3">
            <i class="bi ${icono} fs-3 d-block mb-2 text-secondary" aria-hidden="true"></i>
            <p class="mb-0">${mensaje}</p>
            ${accion}
        </div>`;
}

function botonAgendar() {
    return tienePermiso(estado.usuario, PERMISO.TURNOS_EDITAR)
        ? html`<button type="button" class="btn btn-sm btn-outline-primary mt-3" data-accion="agendar">
                <i class="bi bi-calendar-plus me-1" aria-hidden="true"></i>Agendar un turno</button>`
        : null;
}

// La próxima sesión de hoy que todavía no pasó (pendiente o confirmada)
function proximaSesion(turnosDeHoy) {
    const ahora = new Date().toTimeString().slice(0, 5);
    return turnosDeHoy
        .filter((t) => [ESTADO_TURNO.PENDIENTE, ESTADO_TURNO.CONFIRMADO].includes(t.estado?.id))
        .filter((t) => formatearHora(t.hora) >= ahora)
        .sort((a, b) => formatearHora(a.hora).localeCompare(formatearHora(b.hora)))[0] ?? null;
}

function mostrarProxima(turnosDeHoy) {
    const turno = proximaSesion(turnosDeHoy);
    if (!turno) {
        renderizar($('proxima-cuerpo'), bloqueVacio('No tenés más sesiones por hoy.', 'bi-cup-hot'));
        return;
    }
    const paciente = nombreCompleto(turno.paciente);
    renderizar($('proxima-cuerpo'), html`
        <div class="p-3">
            <div class="d-flex align-items-baseline gap-2 mb-1">
                <span class="dashboard-hora-grande">${formatearHora(turno.hora)}</span>
                ${badgeEstadoTurno(turno.estado)}
            </div>
            <div class="fw-semibold fs-6 mb-3">${paciente}</div>
            <a href="${urlPaciente(turno.paciente?.id)}" class="btn btn-sm btn-eduges">
                <i class="bi bi-person-lines-fill me-1" aria-hidden="true"></i>Ver ficha de ${paciente}
            </a>
        </div>`);
}

function mostrarMetricaHoy(turnosDeHoy) {
    const activos = turnosDeHoy.filter((t) => t.estado?.id !== ESTADO_TURNO.CANCELADO);
    const porAtender = activos.filter((t) => [ESTADO_TURNO.PENDIENTE, ESTADO_TURNO.CONFIRMADO].includes(t.estado?.id));
    $('metrica-hoy').textContent = activos.length;
    $('metrica-hoy-detalle').textContent = activos.length === 0
        ? 'Sin sesiones agendadas'
        : `${porAtender.length} por atender`;
}

async function cargarAgenda() {
    estado.agenda?.abort();
    estado.agenda = new AbortController();
    const { signal } = estado.agenda;
    const fecha = estado.fecha;
    const esHoy = fecha === hoyISO();
    const textos = textoDia(fecha);

    $('agenda-titulo-texto').textContent = textos.titulo;
    $('btn-dia-hoy').disabled = esHoy;
    $('btn-dia-hoy').setAttribute('aria-pressed', esHoy ? 'true' : 'false');
    renderizar($('agenda-cuerpo'), bloqueCargando(3));
    if (esHoy) {
        renderizar($('proxima-cuerpo'), bloqueCargando(2));
    }

    try {
        const lista = await turnos.delDia(fecha, { signal });
        if (signal.aborted) {
            return;
        }
        const ordenados = [...lista].sort((a, b) => formatearHora(a.hora).localeCompare(formatearHora(b.hora)));
        renderizar($('agenda-cuerpo'), ordenados.length > 0
            ? html`<ul class="list-group list-group-flush">${ordenados.map((t) => itemTurno(t))}</ul>`
            : vacioConAccion(textos.vacio, 'bi-calendar-x', botonAgendar()));
        if (esHoy) {
            mostrarProxima(ordenados);
            mostrarMetricaHoy(ordenados);
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            return;
        }
        mostrarError($('agenda-cuerpo'), error, cargarAgenda);
        if (esHoy) {
            mostrarError($('proxima-cuerpo'), error, cargarAgenda);
        }
    }
}

function cambiarDia(dias) {
    estado.fecha = dias === 0 ? hoyISO() : sumarDias(estado.fecha, dias);
    cargarAgenda();
}

async function cargarSinRegistrar() {
    renderizar($('registrar-cuerpo'), bloqueCargando(2));
    try {
        const lista = await turnos.sinRegistrar();
        $('metrica-registrar').textContent = lista.length;
        renderizar($('registrar-cuerpo'), lista.length > 0
            ? html`<ul class="list-group list-group-flush">${lista.map((t) => itemTurno(t, { mostrarFecha: true }))}</ul>`
            : bloqueVacio('Tenés todas tus sesiones registradas.', 'bi-journal-check'));
    } catch (error) {
        $('metrica-registrar').textContent = '—';
        mostrarError($('registrar-cuerpo'), error, cargarSinRegistrar);
    }
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
        // Reintentar vuelve a pedir los pacientes para los dos bloques que los usan
        mostrarError($('cud-cuerpo'), error, recargarPacientes);
    }
}

function recargarPacientes() {
    cargarCud();
    cargarCantidadPacientes();
}

async function cargarCantidadPacientes() {
    try {
        $('metrica-pacientes').textContent = (await pacientes.listar()).length;
    } catch {
        $('metrica-pacientes').textContent = '—';
    }
}

// ------------------------------------------------------------
// Sugerencias para los campos
// ------------------------------------------------------------
const MENSAJE_SIN_PACIENTES = 'No encontramos pacientes tuyos con ese nombre o DNI.';

// La API no busca en el servidor: se filtra la lista de pacientes (ya en memoria)
// por cada palabra escrita, en el nombre, el apellido o el DNI
async function sugerirPacientes(texto) {
    const opciones = (await pacientes.listar()).map((p) => ({
        valor: p.id_paciente,
        texto: nombreCompleto(p, { apellidoPrimero: true }),
        detalle: `DNI ${p.dni}`,
    }));
    return buscarEnLista(opciones)(texto);
}

// Horarios cada 30 minutos de 8 a 20. Se puede escribir "9", "930" o "9:30".
const HORARIOS = Array.from({ length: 25 }, (_, i) => {
    const minutos = 8 * 60 + i * 30;
    const texto = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
    return { valor: texto, texto };
});

async function sugerirHorarios(texto) {
    const digitos = texto.replace(/\D/g, '');
    if (!digitos) {
        return HORARIOS;
    }
    return HORARIOS.filter((h) => {
        const deLaOpcion = h.texto.replace(':', '');
        return deLaOpcion.startsWith(digitos) || deLaOpcion.startsWith(`0${digitos}`);
    });
}

// "9:30", "930", "09:30" → "09:30"; null si no es una hora válida
function normalizarHora(texto) {
    const coincidencia = String(texto ?? '').trim().match(/^(\d{1,2}):?(\d{2})$/);
    if (!coincidencia) {
        return null;
    }
    const [hora, minutos] = [Number(coincidencia[1]), Number(coincidencia[2])];
    if (hora > 23 || minutos > 59) {
        return null;
    }
    return `${String(hora).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

// ------------------------------------------------------------
// Nuevo turno
// ------------------------------------------------------------
let modalTurno = null;
let fechaParaTurno = null;

function prepararFormularioTurno() {
    const formulario = $('form-turno');
    const paciente = crearCombobox($('turno-paciente'), {
        buscar: sugerirPacientes,
        minimo: 1,
        mensajeVacio: MENSAJE_SIN_PACIENTES,
    });
    const hora = crearCombobox($('turno-hora'), {
        buscar: sugerirHorarios,
        textoLibre: true,
        maximo: HORARIOS.length,
        mensajeVacio: 'Escribí la hora con el formato hh:mm, por ejemplo 9:30.',
    });

    modalTurno = prepararModal({
        modal: $('modal-turno'),
        formulario,
        contenedorErrores: $('form-turno-errores'),
        comboboxes: [paciente, hora],
        alAbrir: () => {
            const fecha = $('turno-fecha');
            fecha.min = hoyISO();
            fecha.value = fechaParaTurno && fechaParaTurno >= hoyISO() ? fechaParaTurno : hoyISO();
        },
    });

    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        const datos = {
            paciente: paciente.valor(),
            fecha: formulario.elements.fecha.value,
            hora: normalizarHora(hora.valor()),
            profesional: estado.usuario.profesional.id,
        };
        const errores = {};
        if (!datos.paciente) {
            errores.paciente = [$('turno-paciente').value.trim()
                ? 'Elegí el paciente de la lista de sugerencias.'
                : 'Indicá el paciente.'];
        }
        if (!datos.fecha) {
            errores.fecha = ['Indicá la fecha.'];
        } else if (datos.fecha < hoyISO()) {
            errores.fecha = ['La fecha no puede ser anterior a hoy.'];
        }
        if (!datos.hora) {
            errores.hora = [hora.valor() ? 'Escribí la hora con el formato hh:mm, por ejemplo 9:30.' : 'Indicá la hora.'];
        }
        guardar({
            formulario,
            contenedorErrores: $('form-turno-errores'),
            boton: $('btn-guardar-turno'),
            errores,
            enviar: () => turnos.crear(datos),
            mensajeExito: 'El turno quedó agendado.',
            modal: modalTurno,
            alGuardar: refrescarDashboard,
        });
    });
}

function abrirNuevoTurno(fecha = null) {
    fechaParaTurno = fecha;
    modalTurno().show();
}

// ------------------------------------------------------------
// Dashboard del profesional: armado
// ------------------------------------------------------------
function refrescarDashboard() {
    cargarAgenda();
    if (estado.fecha !== hoyISO()) {
        // La próxima sesión y el número de hoy siempre son de hoy
        turnos.delDia(hoyISO()).then((deHoy) => {
            mostrarProxima(deHoy);
            mostrarMetricaHoy(deHoy);
        }).catch(() => {});
    }
    cargarSinRegistrar();
    cargarCud();
    cargarCantidadPacientes();
}

function mostrarDashboardProfesional() {
    $('vista-profesional').hidden = false;
    $('acciones-profesional').hidden = false;
    $('turno-profesional').textContent = `${nombreCompleto(estado.usuario.profesional)} (vos)`;

    crearCombobox($('buscar-paciente'), {
        buscar: sugerirPacientes,
        minimo: 1,
        mensajeVacio: MENSAJE_SIN_PACIENTES,
        alElegir: (opcion) => opcion && window.location.assign(urlPaciente(opcion.valor)),
    });
    prepararFormularioTurno();
    const abrirNuevoPaciente = prepararFormularioPaciente({ alGuardar: refrescarDashboard });

    $('btn-dia-anterior').addEventListener('click', () => cambiarDia(-1));
    $('btn-dia-siguiente').addEventListener('click', () => cambiarDia(1));
    $('btn-dia-hoy').addEventListener('click', () => cambiarDia(0));
    $('btn-nuevo-turno').addEventListener('click', () => abrirNuevoTurno());
    $('btn-nuevo-paciente').addEventListener('click', abrirNuevoPaciente);
    $('agenda-cuerpo').addEventListener('click', (evento) => {
        if (evento.target.closest('[data-accion="agendar"]')) {
            abrirNuevoTurno(estado.fecha);
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
