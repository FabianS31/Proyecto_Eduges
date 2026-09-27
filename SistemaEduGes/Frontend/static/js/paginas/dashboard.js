// ============================================================
// EduGes - Dashboard (templates/index.html)
// Métricas del día, agenda del día (con acciones sobre cada turno),
// panel de CUD por vencer y registro clínico de la sesión.
// Endpoints: docs/api-contrato.md §5, §6 (cud-por-vencer) y §7.
//
// Cada bloque carga y falla por separado: si una request falla,
// el resto del dashboard se sigue viendo.
// ============================================================

import { ApiError } from '../api.js';
import { DIAS_AVISO_CUD, ESTADO_TURNO, PERMISO, ROL } from '../constantes.js';
import { dashboard, pacientes, sesiones, turnos } from '../endpoints.js';
import { diasEntre, hoyISO, sumarDias } from '../fechas.js';
import { obtenerUsuario, tienePermiso } from '../layout.js';
import {
    badgeCud,
    badgeEstadoTurno,
    bloqueCargando,
    bloqueVacio,
    botonCargando,
    confirmar,
    filaCompleta,
    formatearFecha,
    formatearFechaHora,
    formatearFechaLarga,
    formatearHora,
    html,
    limpiarErroresFormulario,
    mostrarError,
    mostrarErroresFormulario,
    nombreCompleto,
    notificar,
    notificarError,
    renderizar,
    textoVencimientoCud,
} from '../ui.js';

const COLUMNAS_AGENDA = 6;
const LIMITE_PANEL_CUD = 5;
const MAX_NOTA_CLINICA = 5000;

const estado = {
    usuario: null,
    fecha: fechaInicial(),
    controlador: null,        // AbortController de las requests que dependen de la fecha
    turnos: new Map(),        // turnos de la agenda mostrada, por id
    borradores: new Map(),    // notas clínicas sin guardar, por id de turno
};

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------
// Fecha mostrada (se conserva en la URL: /dashboard/?fecha=2026-09-29)
// ------------------------------------------------------------
function fechaInicial() {
    const fecha = new URLSearchParams(window.location.search).get('fecha');
    return /^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '') ? fecha : hoyISO();
}

function cambiarFecha(nuevaFecha) {
    estado.fecha = nuevaFecha;
    const url = new URL(window.location.href);
    if (nuevaFecha === hoyISO()) {
        url.searchParams.delete('fecha');
    } else {
        url.searchParams.set('fecha', nuevaFecha);
    }
    window.history.replaceState(null, '', url);
    cargarDelDia();
}

function textoDia(fecha) {
    const diferencia = diasEntre(hoyISO(), fecha);
    if (diferencia === 0) {
        return 'hoy';
    }
    if (diferencia === 1) {
        return 'mañana';
    }
    if (diferencia === -1) {
        return 'ayer';
    }
    return `el ${formatearFecha(fecha)}`;
}

function actualizarCabecera() {
    const esHoy = estado.fecha === hoyISO();
    $('dashboard-fecha-texto').textContent = formatearFechaLarga(estado.fecha);
    $('agenda-titulo').textContent = `Sesiones programadas para ${textoDia(estado.fecha)}`;
    $('metrica-turnos-titulo').textContent = esHoy ? 'Turnos Hoy' : `Turnos ${formatearFecha(estado.fecha).slice(0, 5)}`;
    $('btn-dia-hoy').disabled = esHoy;
}

// ------------------------------------------------------------
// Ajustes según el rol
// ------------------------------------------------------------
const esProfesional = () => estado.usuario.rol.id === ROL.PROFESIONAL;

function ajustarPorRol() {
    if (!esProfesional()) {
        return;
    }
    // El profesional solo ve su propia agenda: la columna "Profesional" sobra
    document.querySelectorAll('[data-columna="profesional"]').forEach((th) => th.classList.add('d-none'));

    // No ve la cantidad de profesionales: las otras tres métricas ocupan la fila
    $('metrica-profesionales-col').remove();
    document.querySelectorAll('.metrica-col').forEach((col) => col.classList.replace('col-xl-3', 'col-xl-4'));
}

// ------------------------------------------------------------
// Métricas
// ------------------------------------------------------------
const PLACEHOLDER_NUMERO = html`<span class="placeholder-glow"><span class="placeholder" style="width: 2.5rem;"></span></span>`;

function metrica(nombre) {
    return document.querySelector(`[data-metrica="${nombre}"]`);
}

function mostrarMetricas(valores) {
    for (const [nombre, valor] of Object.entries(valores)) {
        const elemento = metrica(nombre);
        if (elemento) {
            renderizar(elemento, valor);
        }
    }
}

// silencioso: actualiza los números sin mostrar el estado de carga (después de una acción)
async function cargarResumen(signal, { silencioso = false } = {}) {
    renderizar($('metricas-error'), '');
    if (!silencioso) {
        mostrarMetricas({
            'turnos-total': PLACEHOLDER_NUMERO,
            'pacientes-activos': PLACEHOLDER_NUMERO,
            'alertas-cud': PLACEHOLDER_NUMERO,
            'profesionales-activos': PLACEHOLDER_NUMERO,
        });
    }

    try {
        const resumen = await dashboard.resumen(estado.fecha, { signal });
        const t = resumen.turnos;
        const porAtender = t.pendientes + t.confirmados;

        mostrarMetricas({
            'turnos-total': t.total,
            'turnos-detalle': `${t.realizados} realizados · ${porAtender} por atender`,
            'pacientes-activos': resumen.pacientes_activos,
            'pacientes-detalle': esProfesional() ? 'Asignados a vos' : 'En tratamiento en el centro',
            'alertas-cud': resumen.alertas_cud,
            'profesionales-activos': resumen.profesionales_activos ?? '—',
        });

        // "4 de 6 completadas": los cancelados no cuentan
        const atendibles = t.total - t.cancelados;
        $('agenda-progreso').textContent = atendibles > 0 ? `${t.realizados} de ${atendibles} completadas` : 'Sin sesiones';
    } catch (error) {
        // Cancelada por un cambio de día: ya hay otra carga en curso
        if (error.name === 'AbortError') {
            return;
        }
        const sinDato = '—';
        mostrarMetricas({
            'turnos-total': sinDato,
            'turnos-detalle': '',
            'pacientes-activos': sinDato,
            'pacientes-detalle': '',
            'alertas-cud': sinDato,
            'profesionales-activos': sinDato,
        });
        $('agenda-progreso').textContent = '';
        mostrarError($('metricas-error'), error, () => cargarResumen(estado.controlador.signal));
    }
}

// ------------------------------------------------------------
// Agenda del día
// ------------------------------------------------------------
const CLASE_FILA = {
    [ESTADO_TURNO.PENDIENTE]: 'table-primary-subtle',
    [ESTADO_TURNO.CANCELADO]: 'opacity-75',
};

function filaTurno(turno) {
    const paciente = turno.paciente;
    return html`
        <tr class="${CLASE_FILA[turno.estado.id] ?? ''}" data-turno-id="${turno.id}">
            <td><span class="fw-bold">${formatearHora(turno.hora_inicio)}</span></td>
            <td>
                <div class="fw-semibold text-dark">${nombreCompleto(paciente, { apellidoPrimero: true })}</div>
                <div class="text-muted small d-flex flex-wrap align-items-center gap-2">
                    <span><i class="bi bi-card-text text-secondary me-1"></i>DNI: ${paciente.dni}</span>
                    ${paciente.cud_estado !== 'vigente' && badgeCud(paciente.cud_estado)}
                </div>
            </td>
            <td>
                <span class="badge bg-light text-dark border">${paciente.obra_social?.nombre ?? 'Particular'}</span>
            </td>
            <td class="${esProfesional() ? 'd-none' : ''}">${nombreCompleto(turno.profesional, { apellidoPrimero: true })}</td>
            <td>${badgeEstadoTurno(turno.estado)}</td>
            <td class="text-end text-nowrap">${accionesTurno(turno)}</td>
        </tr>`;
}

// ------------------------------------------------------------
// Acciones sobre cada turno
// Solo se ofrece lo que la API va a permitir (contrato §2 y §7);
// igual, si la API rechaza algo, se muestra su mensaje.
// ------------------------------------------------------------
function botonAccion(accion, icono, etiqueta, clase, turno) {
    const descripcion = `${etiqueta}: ${formatearHora(turno.hora_inicio)}, ${nombreCompleto(turno.paciente, { apellidoPrimero: true })}`;
    return html`
        <button type="button" class="btn btn-sm btn-light border ${clase}" data-accion="${accion}"
                title="${etiqueta}" aria-label="${descripcion}">
            <i class="bi ${icono}" aria-hidden="true"></i>
        </button>`;
}

function accionesTurno(turno) {
    const usuario = estado.usuario;
    const esPropio = usuario.profesional?.id === turno.profesional.id;
    const puedeEditar = tienePermiso(usuario, PERMISO.TURNOS_EDITAR)
        && (usuario.rol.id === ROL.ADMINISTRADOR || esPropio);
    const puedeRegistrar = esPropio && tienePermiso(usuario, PERMISO.SESIONES_REGISTRAR);
    const puedeVerNota = esPropio && tienePermiso(usuario, PERMISO.SESIONES_VER);
    const noEsFuturo = turno.fecha <= hoyISO();
    const botones = [];

    switch (turno.estado.id) {
    case ESTADO_TURNO.PENDIENTE:
        if (puedeEditar) {
            botones.push(botonAccion('confirmar', 'bi-check2-circle', 'Confirmar turno', 'text-primary', turno));
            botones.push(botonAccion('cancelar', 'bi-x-circle', 'Cancelar turno', 'text-danger', turno));
        }
        break;
    case ESTADO_TURNO.CONFIRMADO:
        if (puedeRegistrar && noEsFuturo) {
            botones.push(botonAccion('registrar', 'bi-journal-plus', 'Registrar sesión', 'text-success', turno));
        } else if (puedeEditar && noEsFuturo) {
            botones.push(botonAccion('realizado', 'bi-check2-all', 'Marcar como realizado', 'text-success', turno));
        }
        if (puedeEditar) {
            botones.push(botonAccion('cancelar', 'bi-x-circle', 'Cancelar turno', 'text-danger', turno));
        }
        break;
    case ESTADO_TURNO.REALIZADO:
        if (turno.tiene_registro_sesion && puedeVerNota) {
            botones.push(botonAccion('ver', 'bi-file-earmark-medical', 'Ver evolución', 'text-success', turno));
        } else if (!turno.tiene_registro_sesion && puedeRegistrar) {
            botones.push(botonAccion('registrar', 'bi-journal-plus', 'Registrar sesión', 'text-warning-emphasis', turno));
        }
        break;
    default:
        break;
    }

    return botones.length > 0 ? html`<div class="d-inline-flex gap-1">${botones}</div>` : html``;
}

// Pone el foco en el primer botón de la fila del turno (o en la fila si no tiene botones),
// para que quien usa teclado no pierda su lugar cuando la fila se redibuja.
function enfocarTurno(turnoId) {
    const fila = $('agenda-cuerpo').querySelector(`tr[data-turno-id="${turnoId}"]`);
    if (!fila) {
        return;
    }
    const boton = fila.querySelector('button[data-accion]');
    if (boton) {
        boton.focus();
    } else {
        fila.tabIndex = -1;
        fila.focus();
    }
}

// Reemplaza la fila del turno con los datos nuevos, sin recargar toda la agenda
function actualizarTurnoEnAgenda(turno) {
    estado.turnos.set(turno.id, turno);
    const fila = $('agenda-cuerpo').querySelector(`tr[data-turno-id="${turno.id}"]`);
    if (!fila) {
        return;
    }
    const teniaElFoco = fila.contains(document.activeElement);
    fila.outerHTML = String(filaTurno(turno));
    if (teniaElFoco) {
        enfocarTurno(turno.id);
    }
}

// Después de un cambio: métricas al día sin parpadeo
function refrescarResumen() {
    cargarResumen(estado.controlador.signal, { silencioso: true });
}

async function cambiarEstadoTurno(boton, operacion, mensajeExito) {
    botonCargando(boton, true, '');
    try {
        const actualizado = await operacion();
        actualizarTurnoEnAgenda(actualizado);
        refrescarResumen();
        notificar(mensajeExito);
    } catch (error) {
        notificarError(error);
        // Si la API lo rechazó, probablemente la agenda está desactualizada (otro usuario lo cambió)
        if ([400, 404, 409].includes(error.status)) {
            cargarAgenda(estado.controlador.signal);
            refrescarResumen();
        } else {
            botonCargando(boton, false);
        }
    }
}

const ACCIONES = {
    confirmar: (turno, boton) =>
        cambiarEstadoTurno(boton, () => turnos.confirmar(turno.id), 'Turno confirmado.'),

    realizado: (turno, boton) =>
        cambiarEstadoTurno(boton, () => turnos.cambiarEstado(turno.id, ESTADO_TURNO.REALIZADO), 'Turno marcado como realizado.'),

    cancelar: async (turno, boton) => {
        const aceptado = await confirmar({
            titulo: '¿Cancelar el turno?',
            mensaje: `${formatearHora(turno.hora_inicio)} hs · ${nombreCompleto(turno.paciente)}. El horario queda libre y no se puede deshacer.`,
            textoAceptar: 'Cancelar turno',
            textoCancelar: 'Volver',
            peligro: true,
        });
        if (aceptado) {
            await cambiarEstadoTurno(boton, () => turnos.cancelar(turno.id), 'Turno cancelado.');
        }
    },

    registrar: (turno) => abrirModalSesion(turno, 'registrar'),

    ver: (turno) => abrirModalSesion(turno, 'ver'),
};

function alHacerClicEnAgenda(evento) {
    const boton = evento.target.closest('button[data-accion]');
    const fila = boton?.closest('tr[data-turno-id]');
    const turno = fila && estado.turnos.get(Number(fila.dataset.turnoId));
    if (turno && ACCIONES[boton.dataset.accion]) {
        ACCIONES[boton.dataset.accion](turno, boton);
    }
}

async function cargarAgenda(signal) {
    const cuerpo = $('agenda-cuerpo');
    renderizar(cuerpo, filaCompleta(COLUMNAS_AGENDA, bloqueCargando(3)));

    try {
        const lista = await turnos.delDia(estado.fecha, {}, { signal });
        estado.turnos = new Map(lista.map((turno) => [turno.id, turno]));
        renderizar(cuerpo, lista.length > 0
            ? lista.map(filaTurno)
            : filaCompleta(COLUMNAS_AGENDA, bloqueVacio(`No hay turnos programados para ${textoDia(estado.fecha)}.`, 'bi-calendar-x')));
    } catch (error) {
        mostrarError(cuerpo, error, () => cargarAgenda(estado.controlador.signal), { colspan: COLUMNAS_AGENDA });
    }
}

// ------------------------------------------------------------
// Panel de CUD (no depende del día elegido)
// ------------------------------------------------------------
function telefonoParaLlamar(telefono) {
    return telefono ? telefono.replace(/[^\d+]/g, '') : null;
}

function itemCud(paciente) {
    const vencido = paciente.cud_estado === 'vencido';
    const tutor = paciente.tutor_principal;
    const telefono = telefonoParaLlamar(tutor?.telefono_movil);
    const nombre = nombreCompleto(paciente);

    const botonLlamar = telefono
        ? html`<a class="btn btn-sm btn-outline-secondary border-0" href="tel:${telefono}"
                  title="Llamar a ${tutor.nombre}" aria-label="Llamar a ${tutor.nombre}, tutor de ${nombre}">
                  <i class="bi bi-telephone-outbound"></i></a>`
        : html`<span class="btn btn-sm border-0 text-muted disabled" title="Sin teléfono cargado" aria-hidden="true">
                  <i class="bi bi-telephone-x"></i></span>`;

    return html`
        <div class="cud-item ${vencido ? 'cud-item-vencido' : 'cud-item-alerta'} p-2 d-flex justify-content-between align-items-center gap-2">
            <div>
                <div class="fw-semibold small">${nombre}</div>
                <small class="${vencido ? 'text-danger' : 'text-warning-emphasis'} fw-semibold">
                    ${textoVencimientoCud(paciente.dias_restantes)} · ${formatearFecha(paciente.cud_vencimiento)}
                </small>
                <div class="text-muted" style="font-size: 0.75rem;">
                    ${tutor ? html`Tutor: ${tutor.nombre}${tutor.telefono_movil ? html` · ${tutor.telefono_movil}` : ''}` : 'Sin tutor cargado'}
                </div>
            </div>
            ${botonLlamar}
        </div>`;
}

async function cargarCud() {
    const lista = $('cud-lista');
    if (!lista) {
        return; // el rol no tiene permiso para ver pacientes: el panel no existe
    }
    const contador = $('cud-contador');
    renderizar(lista, bloqueCargando(2));
    contador.textContent = '';

    try {
        // Se piden todos para mostrar el total real; se listan los más urgentes
        const todos = await pacientes.cudPorVencer({ dias: DIAS_AVISO_CUD });
        contador.textContent = todos.length === 1 ? '1 paciente' : `${todos.length} pacientes`;
        renderizar(lista, todos.length > 0
            ? todos.slice(0, LIMITE_PANEL_CUD).map(itemCud)
            : bloqueVacio('No hay certificados vencidos ni por vencer.', 'bi-shield-check'));
    } catch (error) {
        mostrarError(lista, error, cargarCud);
    }
}

// ------------------------------------------------------------
// Registro clínico de la sesión (modal)
// modo 'registrar': nota nueva (POST). Lo escrito se guarda como borrador
//                   si se cierra el modal sin guardar.
// modo 'ver':       muestra la nota existente y permite corregirla (PATCH).
// ------------------------------------------------------------
const modalSesion = {
    turno: null,
    modo: null,
    notaOriginal: '',
    turnoOrigen: null, // turno cuyo botón abrió el modal: al cerrar, el foco vuelve ahí
};

let placeholderNota = '';

const modalBootstrap = () => window.bootstrap.Modal.getOrCreateInstance($('modalSesion'));

function actualizarContador() {
    const largo = $('tratamientoAplicado').value.length;
    const contador = $('tratamientoAplicado-contador');
    contador.textContent = `${largo} / ${MAX_NOTA_CLINICA}`;
    contador.classList.toggle('excedido', largo >= MAX_NOTA_CLINICA);
}

function mostrarErroresGenerales(mensajes) {
    renderizar($('modal-sesion-errores'), mensajes.length > 0
        ? html`<div class="alert alert-danger small py-2" role="alert">${mensajes.map((m) => html`<div>${m}</div>`)}</div>`
        : '');
}

function mostrarAuditoria(sesion) {
    const partes = [];
    if (sesion.creado) {
        partes.push(`Registrada el ${formatearFechaHora(sesion.creado)}${sesion.autor ? ` por ${nombreCompleto(sesion.autor)}` : ''}.`);
    }
    if (sesion.modificado) {
        partes.push(`Última corrección: ${formatearFechaHora(sesion.modificado)}.`);
    }
    $('modal-sesion-auditoria').textContent = partes.join(' ');
}

async function abrirModalSesion(turno, modo) {
    const formulario = $('form-sesion');
    const nota = $('tratamientoAplicado');
    const guardar = $('btn-guardar-sesion');

    modalSesion.turno = turno;
    modalSesion.modo = modo;
    modalSesion.notaOriginal = '';
    modalSesion.turnoOrigen = turno.id;

    limpiarErroresFormulario(formulario);
    mostrarErroresGenerales([]);
    $('modal-sesion-auditoria').textContent = '';
    $('modal-sesion-titulo').textContent = modo === 'ver' ? 'Evolución Clínica de la Sesión' : 'Registro Clínico de Sesión';
    renderizar($('modal-sesion-paciente'), html`
        ${nombreCompleto(turno.paciente, { apellidoPrimero: true })}
        ${turno.paciente.cud_estado !== 'vigente' && badgeCud(turno.paciente.cud_estado)}
        <div class="small text-muted fw-normal">Turno del ${formatearFecha(turno.fecha)} · ${formatearHora(turno.hora_inicio)} hs</div>`);
    $('modal-sesion-profesional').textContent = nombreCompleto(turno.profesional);

    // "Marcar como realizado" solo tiene sentido para una nota nueva de un turno confirmado
    const mostrarMarcar = modo === 'registrar' && turno.estado.id === ESTADO_TURNO.CONFIRMADO;
    $('modal-sesion-marcar').classList.toggle('d-none', !mostrarMarcar);
    $('turnoRealizado').checked = true;

    guardar.textContent = modo === 'ver' ? 'Guardar Cambios' : 'Guardar Evolución';

    if (modo === 'registrar') {
        nota.value = estado.borradores.get(turno.id) ?? '';
        nota.disabled = false;
        nota.placeholder = placeholderNota;
        guardar.disabled = false;
    } else {
        nota.value = '';
        nota.disabled = true;
        nota.placeholder = 'Cargando la evolución…';
        guardar.disabled = true;
    }
    actualizarContador();
    modalBootstrap().show();

    if (modo !== 'ver') {
        return;
    }
    try {
        const sesion = await sesiones.obtener(turno.id);
        if (modalSesion.turno !== turno) {
            return; // se cerró o se abrió otro turno mientras cargaba
        }
        nota.value = sesion.nota_clinica;
        nota.disabled = false;
        nota.placeholder = placeholderNota;
        modalSesion.notaOriginal = sesion.nota_clinica;
        actualizarContador();
        mostrarAuditoria(sesion);
    } catch (error) {
        if (modalSesion.turno === turno) {
            nota.placeholder = '';
            mostrarErroresGenerales([error.message ?? 'No se pudo cargar la evolución.']);
        }
    }
}

function alEscribirNota() {
    const nota = $('tratamientoAplicado');
    actualizarContador();
    nota.classList.remove('is-invalid');

    if (modalSesion.modo === 'registrar') {
        estado.borradores.set(modalSesion.turno.id, nota.value);
    } else if (modalSesion.modo === 'ver') {
        // En modo corrección, "Guardar" se habilita solo si hubo cambios
        $('btn-guardar-sesion').disabled = nota.value.trim() === modalSesion.notaOriginal.trim();
    }
}

async function guardarSesion(evento) {
    evento.preventDefault();
    const formulario = $('form-sesion');
    const nota = $('tratamientoAplicado');
    const guardar = $('btn-guardar-sesion');
    const { turno, modo } = modalSesion;
    const texto = nota.value.trim();

    // Validación mínima antes de ir a la API (la API vuelve a validar)
    if (!texto) {
        mostrarErroresFormulario(formulario, new ApiError(400, { nota_clinica: ['Escribí la evolución antes de guardar.'] }));
        nota.focus();
        return;
    }

    limpiarErroresFormulario(formulario);
    mostrarErroresGenerales([]);
    botonCargando(guardar, true);

    try {
        if (modo === 'registrar') {
            const marcarRealizado = !$('modal-sesion-marcar').classList.contains('d-none') && $('turnoRealizado').checked;
            await sesiones.registrar(turno.id, texto, marcarRealizado);
            estado.borradores.delete(turno.id);
        } else {
            await sesiones.actualizar(turno.id, texto);
        }
    } catch (error) {
        botonCargando(guardar, false);
        mostrarErroresGenerales(mostrarErroresFormulario(formulario, error));
        return;
    }

    botonCargando(guardar, false);
    modalBootstrap().hide();
    notificar(modo === 'registrar' ? 'Evolución registrada.' : 'Evolución actualizada.');

    // El turno pudo cambiar de estado (Realizado) y ahora tiene registro: se actualiza su fila
    try {
        actualizarTurnoEnAgenda(await turnos.obtener(turno.id));
        refrescarResumen();
    } catch {
        cargarAgenda(estado.controlador.signal);
    }
}

function prepararModalSesion() {
    const nota = $('tratamientoAplicado');
    placeholderNota = nota.placeholder;
    nota.addEventListener('input', alEscribirNota);
    $('form-sesion').addEventListener('submit', guardarSesion);

    const modal = $('modalSesion');
    modal.addEventListener('shown.bs.modal', () => {
        if (!nota.disabled) {
            nota.focus();
        }
    });
    modal.addEventListener('hidden.bs.modal', () => {
        modalSesion.turno = null;
        modalSesion.modo = null;
        // Bootstrap no devuelve el foco porque el modal se abre por código
        enfocarTurno(modalSesion.turnoOrigen);
    });
}

// ------------------------------------------------------------
// Carga
// ------------------------------------------------------------
function cargarDelDia() {
    // Si se cambia de día rápido, se cancelan las requests del día anterior
    estado.controlador?.abort();
    estado.controlador = new AbortController();
    actualizarCabecera();
    cargarResumen(estado.controlador.signal);
    cargarAgenda(estado.controlador.signal);
}

async function iniciar() {
    $('btn-dia-anterior').addEventListener('click', () => cambiarFecha(sumarDias(estado.fecha, -1)));
    $('btn-dia-siguiente').addEventListener('click', () => cambiarFecha(sumarDias(estado.fecha, 1)));
    $('btn-dia-hoy').addEventListener('click', () => cambiarFecha(hoyISO()));
    $('agenda-cuerpo').addEventListener('click', alHacerClicEnAgenda);
    prepararModalSesion();
    actualizarCabecera();

    try {
        estado.usuario = await obtenerUsuario();
    } catch (error) {
        // 401: api.js ya redirige al login. Otro error: se muestra en los bloques.
        if (error.status !== 401) {
            mostrarError($('agenda-cuerpo'), error, () => window.location.reload(), { colspan: COLUMNAS_AGENDA });
        }
        return;
    }

    if (!tienePermiso(estado.usuario, PERMISO.DASHBOARD_VER)) {
        renderizar($('agenda-cuerpo'), filaCompleta(COLUMNAS_AGENDA, bloqueVacio('No tenés acceso al panel general.', 'bi-lock')));
        return;
    }

    ajustarPorRol();
    cargarDelDia();
    cargarCud();
}

iniciar();
