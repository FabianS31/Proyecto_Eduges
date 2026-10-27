// ============================================================
// EduGes - Turnos: lo común a Inicio, Turnos y la ficha del paciente
//
//   - Datos: obtenerTurnos() → turnos con el paciente (y el profesional, para los administradores)
//   - Presentación: itemTurno(), badgeEstadoTurno(), formatearHora(), diaEnTexto()…
//   - Acciones: prepararTurnos() arma los modales de templates/componentes/modales_turno.html
//     (Nuevo turno, Reprogramar), la cancelación y los cambios de estado
//     (Confirmar, Marcar realizado, Marcar ausente).
//
//   const acciones = prepararTurnos({ usuario, alCambiar: recargar, focoTrasCambio: () => titulo });
//   acciones.escuchar(contenedor);                    // botones Reprogramar / Cancelar de la lista
//   acciones.abrirNuevo({ fecha, paciente });         // los dos son opcionales
//
// Reglas de la API (APIs/turnos/services/turno_service.py): hasta 30 días hacia adelante,
// nunca un horario pasado, 1 hora de duración, sin superponerse con otro turno del
// profesional ni del paciente. Se validan también acá para avisar antes y con más detalle.
// ============================================================

import { ApiError } from '../api.js';
import { buscarEnLista, crearCombobox } from './combobox.js';
import { guardar, prepararModal } from './formularios.js';
import { prepararModalSesion } from './sesion-modal.js';
import { crearSelectorFechas } from './selector-fechas.js';
import {
    ESTADO_PACIENTE,
    ESTADO_TURNO,
    PERMISO,
    TURNO_DIAS_ANTICIPACION,
    TURNO_DURACION_MINUTOS,
} from '../constantes.js';
import { pacientes, profesionales, turnos } from '../endpoints.js';
import { aFecha, edad, hoyISO, sumarDias } from '../fechas.js';
import { esProfesional, tienePermiso } from '../layout.js';
import {
    confirmar,
    formatearFecha,
    html,
    icono,
    nombreCompleto,
    notificar,
    notificarError,
    renderizar,
} from '../ui.js';

const $ = (id) => document.getElementById(id);

let usuarioActual = null;
let turnosPorId = new Map();
let firmaDibujada = null;   // cómo estaban los turnos respecto de la hora la última vez que se dibujaron

// ------------------------------------------------------------
// Presentación
// ------------------------------------------------------------
// "09:30:00" → "09:30"
export const formatearHora = (hora) => (hora ? hora.slice(0, 5) : '—');

const ahoraHora = () => new Date().toTimeString().slice(0, 5);

const minutosDe = (hora) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

function sumarMinutos(hora, minutos) {
    const total = minutosDe(hora) + minutos;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const fechaMaximaTurno = () => sumarDias(hoyISO(), TURNO_DIAS_ANTICIPACION);

// La API devuelve el estado como { ID_EstadoTurno, Estado }
const idEstado = (turno) => turno.estado?.id ?? turno.estado?.ID_EstadoTurno;

// Pendiente o confirmado: todavía se puede atender, reprogramar o cancelar
export const estaActivo = (turno) => [ESTADO_TURNO.PENDIENTE, ESTADO_TURNO.CONFIRMADO].includes(idEstado(turno));

export const estaCancelado = (turno) => idEstado(turno) === ESTADO_TURNO.CANCELADO;

export const yaEmpezo = (turno) => turno.fecha < hoyISO()
    || (turno.fecha === hoyISO() && formatearHora(turno.hora) <= ahoraHora());

// Pasó la hora de duración del turno (recién ahí se puede marcar como realizado)
const yaTermino = (turno) => turno.fecha < hoyISO()
    || (turno.fecha === hoyISO() && sumarMinutos(formatearHora(turno.hora), TURNO_DURACION_MINUTOS) <= ahoraHora());

const FORMATO_DIA = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

// "martes 6 de octubre" (sin coma ni año)
export const diaEnTexto = (fecha) => FORMATO_DIA.format(aFecha(fecha)).replace(',', '');

export const conMayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

// La API devuelve solo los IDs: los nombres salen de las listas de pacientes y profesionales.
// Si no están (ej.: el paciente ya no está asignado a este profesional), se muestra el número.
export function nombrePaciente(turno, opciones) {
    const id = turno.paciente?.id ?? turno.paciente_id ?? '—';
    return turno.paciente ? nombreCompleto(turno.paciente, opciones) : `Paciente N° ${id}`;
}

export function nombreProfesional(turno) {
    const id = turno.profesional?.id ?? turno.profesional_id ?? '—';
    return turno.profesional ? nombreCompleto(turno.profesional) : `Profesional N° ${id}`;
}

// Estado del turno: siempre con ícono y texto, no solo color
const ESTILO_ESTADO_TURNO = {
    [ESTADO_TURNO.PENDIENTE]: { chip: 'eg-chip--warn', icono: 'hourglass_empty', fila: 'is-pending' },
    [ESTADO_TURNO.CONFIRMADO]: { chip: 'eg-chip--info', icono: 'event_available', fila: 'is-pending' },
    [ESTADO_TURNO.CANCELADO]: { chip: 'eg-chip--err', icono: 'event_busy', fila: 'is-cancelled' },
    [ESTADO_TURNO.REALIZADO]: { chip: '', icono: 'task_alt', fila: 'is-done' },
    [ESTADO_TURNO.AUSENTE]: { chip: '', icono: 'person_off', fila: 'is-done is-absent' },
};

const estiloDe = (estadoTurno) => ESTILO_ESTADO_TURNO[estadoTurno?.id ?? estadoTurno?.ID_EstadoTurno] ?? { chip: '', icono: 'help', fila: '' };

// estadoTurno: { ID_EstadoTurno, Estado }, como lo devuelve la API
export function badgeEstadoTurno(estadoTurno) {
    const estilo = estiloDe(estadoTurno);
    const nombre = estadoTurno?.nombre ?? estadoTurno?.Estado ?? 'Sin estado';
    return html`<span class="eg-chip ${estilo.chip}">${icono(estilo.icono)}${nombre}</span>`;
}

// Clase de color para la agenda: realizado, cancelado, pendiente o la próxima sesión
export function claseTurno(turno, { esProxima = false } = {}) {
    return esProxima ? 'is-next' : estiloDe(turno.estado).fila;
}

export const urlPaciente = (id) => `/pacientes/?paciente=${encodeURIComponent(id)}`;

const puedeEditar = () => tienePermiso(usuarioActual, PERMISO.TURNOS_EDITAR);

// Marcar asistencia (realizado o ausente): el profesional del turno o el SuperAdministrador
const puedeMarcarAsistencia = () => tienePermiso(usuarioActual, PERMISO.SESIONES_REGISTRAR);

const boton = (accion, turno, { texto, nombreIcono, clase = '', descripcion }) => html`
    <button type="button" class="eg-btn ${clase}" data-accion="${accion}" data-turno="${turno.id_turno}"
            aria-label="${texto} ${descripcion}">
        ${icono(nombreIcono)}${texto}
    </button>`;

// Solo los botones que la API va a aceptar según el estado y la hora del turno.
// Principales: lo más probable en ese momento (se ven siempre).
// Secundarias: Reprogramar y Cancelar, dentro de "Más acciones" (para que la fila no quede cargada).
function accionesTurno(turno, descripcion) {
    const principales = [];
    const secundarias = [];
    if (!usuarioActual) {
        return { principales, secundarias };
    }
    const estadoId = idEstado(turno);
    if (puedeEditar() && estadoId === ESTADO_TURNO.PENDIENTE) {
        principales.push(boton('confirmar', turno, { texto: 'Confirmar', nombreIcono: 'check', clase: 'eg-btn--ok', descripcion }));
    }
    if (puedeMarcarAsistencia() && yaTermino(turno)
        && [ESTADO_TURNO.CONFIRMADO, ESTADO_TURNO.AUSENTE].includes(estadoId)) {
        principales.push(boton('realizado', turno, { texto: 'Marcar realizado', nombreIcono: 'task_alt', clase: 'eg-btn--ok', descripcion }));
    }
    if (puedeMarcarAsistencia() && yaEmpezo(turno) && estadoId === ESTADO_TURNO.CONFIRMADO) {
        principales.push(boton('ausente', turno, { texto: 'Marcar ausente', nombreIcono: 'person_off', descripcion }));
    }
    if (estadoId === ESTADO_TURNO.REALIZADO) {
        const textoSesion = esProfesional(usuarioActual) ? 'Nota clínica' : 'Ver resumen';
        principales.push(boton('sesion', turno, { texto: textoSesion, nombreIcono: 'clinical_notes', clase: 'eg-btn--secondary', descripcion }));
    } else if (estadoId === ESTADO_TURNO.CONFIRMADO && (yaEmpezo(turno) || turno.fecha < hoyISO()) && esProfesional(usuarioActual)) {
        principales.push(boton('sesion', turno, { texto: 'Tomar notas', nombreIcono: 'edit_note', clase: 'eg-btn--primary', descripcion }));
    }
    if (puedeEditar() && estaActivo(turno) && !yaEmpezo(turno)) {
        secundarias.push(
            boton('reprogramar', turno, { texto: 'Reprogramar', nombreIcono: 'event_repeat', descripcion }),
            boton('cancelar', turno, { texto: 'Cancelar', nombreIcono: 'event_busy', clase: 'eg-btn--danger', descripcion }),
        );
    }
    return { principales, secundarias };
}

// "Más acciones": un <details> del navegador (se abre y cierra con Enter o Espacio,
// el lector de pantalla dice si está abierto). Las opciones aparecen al lado, con su texto.
function masAcciones(secundarias, descripcion) {
    if (secundarias.length === 0) {
        return null;
    }
    return html`
        <details class="eg-mas">
            <summary class="eg-btn" aria-label="Más acciones para ${descripcion}">
                ${icono('more_horiz')}Más acciones${icono('expand_more', 'eg-mas__flecha')}
            </summary>
            <div class="eg-mas__opciones">${secundarias}</div>
        </details>`;
}

// "Hoy", "Mañana" o "Lunes 19 de octubre"
export function etiquetaDia(fecha) {
    if (fecha === hoyISO()) {
        return 'Hoy';
    }
    if (fecha === sumarDias(hoyISO(), 1)) {
        return 'Mañana';
    }
    return conMayuscula(diaEnTexto(fecha));
}

// "8 años" (si se conoce el paciente)
const edadPaciente = (turno) => (turno.paciente?.fecha_nacimiento ? `${edad(turno.paciente.fecha_nacimiento)} años` : null);

// Un turno en una lista: hora, quién, estado y acciones con texto visible.
//   conPaciente: el nombre del paciente es lo principal (agendas); si no, la fecha (ficha del paciente)
//   conProfesional: muestra con quién es el turno (administradores)
//   esProxima: la próxima sesión del día (se resalta)
//   conDia: muestra el día ("Hoy", "Mañana", "lunes 19 de octubre") en listas de varios días
export function itemTurno(turno, { conPaciente = true, conProfesional = false, conDia = false, esProxima = false } = {}) {
    const paciente = nombrePaciente(turno, { apellidoPrimero: true });
    const principal = conPaciente ? paciente : conMayuscula(diaEnTexto(turno.fecha));
    const detalle = [
        conDia && etiquetaDia(turno.fecha),
        conPaciente && edadPaciente(turno),
        conProfesional && `Con ${nombreProfesional(turno)}`,
    ].filter(Boolean).join(' · ');
    const descripcion = conPaciente
        ? `el turno de ${paciente} de las ${formatearHora(turno.hora)}`
        : `el turno del ${diaEnTexto(turno.fecha)} a las ${formatearHora(turno.hora)}`;
    const acciones = accionesTurno(turno, descripcion);
    return html`
        <li class="eg-turno ${claseTurno(turno, { esProxima })}">
            <div class="eg-turno__time">
                <span class="eg-turno__hour">${formatearHora(turno.hora)}</span>
                <span class="eg-turno__dur">${TURNO_DURACION_MINUTOS} min</span>
            </div>
            <div class="eg-turno__bar" aria-hidden="true"></div>
            <div class="eg-turno__info">
                <span class="eg-turno__name">${principal}</span>
                ${detalle && html`<span class="eg-turno__detail">${detalle}</span>`}
            </div>
            <div class="eg-turno__actions">
                ${esProxima && html`<span class="eg-chip eg-chip--primary">${icono('schedule')}Próxima</span>`}
                ${badgeEstadoTurno(turno.estado)}
                ${acciones.principales}
                ${conPaciente && turno.paciente && html`
                    <a href="${urlPaciente(turno.paciente_id)}" class="eg-btn" aria-label="Ver ficha de ${paciente}">
                        ${icono('folder_open')}Ver ficha
                    </a>`}
                ${masAcciones(acciones.secundarias, descripcion)}
            </div>
        </li>`;
}

// Lista de turnos (<ul>), con la próxima sesión resaltada si está en la lista
export function listaTurnos(lista, { proxima = null, ...opciones } = {}) {
    return html`<ul class="eg-lista-turnos">${lista.map((t) => itemTurno(t, { ...opciones, esProxima: t === proxima }))}</ul>`;
}

// La próxima sesión de hoy que todavía no empezó (pendiente o confirmada)
export function proximaDeHoy(lista) {
    return lista.find((t) => t.fecha === hoyISO() && estaActivo(t) && !yaEmpezo(t)) ?? null;
}

// ------------------------------------------------------------
// Datos
// ------------------------------------------------------------
// Turnos ordenados por fecha y hora, con el paciente y el profesional (objetos o null).
// Si la lista de pacientes o de profesionales falla, los turnos se muestran igual (con números).
export async function obtenerTurnos() {
    const deProfesional = esProfesional(usuarioActual);
    const [lista, listaPacientes, listaProfesionales] = await Promise.all([
        turnos.listar(),
        pacientes.listar().catch(() => []),
        deProfesional ? Promise.resolve([]) : profesionales.listar().catch(() => []),
    ]);
    const pacientesPorId = new Map(listaPacientes.map((p) => [p.id_paciente, p]));
    const profesionalesPorId = new Map(listaProfesionales.map((p) => [p.id_profesional, p]));
    const yo = deProfesional ? usuarioActual.profesional : null;
    const completos = lista
        .map((t) => {
            const pacId = t.paciente?.id ?? t.paciente_id;
            const profId = t.profesional?.id ?? t.profesional_id;
            const pac = (pacId ? pacientesPorId.get(pacId) : null) ?? t.paciente ?? null;
            const prof = yo ?? (profId ? profesionalesPorId.get(profId) : null) ?? t.profesional ?? null;
            return {
                ...t,
                paciente_id: pacId,
                profesional_id: profId,
                paciente: pac,
                profesional: prof,
            };
        })
        .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
    turnosPorId = new Map(completos.map((t) => [t.id_turno, t]));
    firmaDibujada = firmaHoraria(completos);
    return completos;
}

// ------------------------------------------------------------
// Actualización con la hora
// Los botones dependen de la hora (Marcar ausente desde que empieza el turno, Marcar realizado
// cuando termina) y también la próxima sesión. Si la pantalla queda abierta, se vuelve a dibujar
// sola cuando algo de eso cambia, sin pedir nada al servidor.
// ------------------------------------------------------------

// Lo que depende de la hora: qué turnos ya empezaron o terminaron, cuál es la próxima y qué día es
function firmaHoraria(lista) {
    const proxima = proximaDeHoy(lista);
    return `${hoyISO()}|${proxima?.id_turno ?? '-'}|${lista.map((t) => `${t.id_turno}${yaEmpezo(t) ? 1 : 0}${yaTermino(t) ? 1 : 0}`).join(',')}`;
}

// No se redibuja mientras la persona está usando esa parte de la pantalla:
// con el foco adentro, con "Más acciones" abierto o con un modal abierto (se reintenta después)
function estaEnUso(zonas) {
    return Boolean(document.querySelector('.modal.show'))
        || zonas.some((zona) => zona.contains(document.activeElement) || zona.querySelector('details[open]'));
}

// zonas: () => [elementos] que se redibujan. redibujar: dibuja de nuevo (devuelve una Promise).
// Mientras se redibuja, las zonas con aria-live no anuncian nada: el lector de pantalla
// no repite la agenda entera cada vez que pasa un turno.
export function actualizarConLaHora({ zonas, redibujar, cadaSegundos = 30 }) {
    return setInterval(async () => {
        if (firmaDibujada === null || firmaHoraria([...turnosPorId.values()]) === firmaDibujada) {
            return;
        }
        const elementos = zonas().filter(Boolean);
        if (estaEnUso(elementos)) {
            return;
        }
        const conAviso = elementos.filter((zona) => zona.getAttribute('aria-live') === 'polite');
        conAviso.forEach((zona) => zona.setAttribute('aria-live', 'off'));
        try {
            await redibujar();
        } finally {
            setTimeout(() => conAviso.forEach((zona) => zona.setAttribute('aria-live', 'polite')), 1000);
        }
    }, cadaSegundos * 1000);
}

// Turnos activos que se pisan con fecha + hora, del mismo profesional o del mismo paciente
function turnosQueSePisan(fecha, hora, { profesional, paciente, excepto = null }) {
    const inicio = minutosDe(hora);
    return [...turnosPorId.values()].filter((t) => t.id_turno !== excepto
        && t.fecha === fecha
        && estaActivo(t)
        && (t.profesional_id === profesional || t.paciente_id === paciente)
        && Math.abs(minutosDe(formatearHora(t.hora)) - inicio) < TURNO_DURACION_MINUTOS);
}

function textoChoque(turno, profesional) {
    const inicio = formatearHora(turno.hora);
    const rango = `de ${inicio} a ${sumarMinutos(inicio, TURNO_DURACION_MINUTOS)}`;
    if (esProfesional(usuarioActual)) {
        return `Ya tenés un turno ${rango} con ${nombrePaciente(turno)} ese día. Elegí otra hora.`;
    }
    return turno.profesional_id === profesional
        ? `${nombreProfesional(turno)} ya tiene un turno ${rango} con ${nombrePaciente(turno)} ese día. Elegí otra hora.`
        : `${nombrePaciente(turno)} ya tiene un turno ${rango} con ${nombreProfesional(turno)} ese día. Elegí otra hora.`;
}

// ------------------------------------------------------------
// Sugerencias para los campos
// ------------------------------------------------------------
export function mensajeSinPacientes() {
    return esProfesional(usuarioActual)
        ? 'No encontramos pacientes tuyos con ese nombre o DNI.'
        : 'No encontramos pacientes con ese nombre o DNI.';
}

const opcionPaciente = (p) => ({
    valor: p.id_paciente,
    texto: nombreCompleto(p, { apellidoPrimero: true }),
    detalle: `DNI ${p.dni}`,
});

// La API no busca en el servidor: se filtra la lista de pacientes (ya en memoria)
// por cada palabra escrita, en el nombre, el apellido o el DNI
export async function sugerirPacientes(texto) {
    return buscarEnLista((await pacientes.listar()).map(opcionPaciente))(texto);
}

// Para dar un turno: solo pacientes activos (la API no acepta turnos de pacientes inactivos)
async function sugerirPacientesActivos(texto) {
    const todos = await pacientes.listar();
    const activos = todos.filter((p) => {
        const id = p.estado?.id ?? p.estado;
        return id === ESTADO_PACIENTE.ACTIVO;
    });
    return buscarEnLista(activos.map(opcionPaciente))(texto);
}

async function sugerirProfesionales(texto) {
    const opciones = (await profesionales.listar()).map((p) => ({
        valor: p.id_profesional,
        texto: nombreCompleto(p, { apellidoPrimero: true }),
        detalle: `Matrícula ${p.matricula}`,
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

const MENSAJE_HORA_INVALIDA = 'Escribí la hora con el formato hh:mm, por ejemplo 9:30.';

const crearComboboxHora = (input) => crearCombobox(input, {
    buscar: sugerirHorarios,
    textoLibre: true,
    maximo: HORARIOS.length,
    mensajeVacio: MENSAJE_HORA_INVALIDA,
});

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
// Validaciones (las mismas reglas que la API, con mensajes más concretos)
// ------------------------------------------------------------
function errorDeFecha(fecha) {
    if (!fecha) {
        return 'Indicá la fecha.';
    }
    if (fecha < hoyISO()) {
        return 'La fecha no puede ser anterior a hoy.';
    }
    if (fecha > fechaMaximaTurno()) {
        return `Se pueden dar turnos hasta ${TURNO_DIAS_ANTICIPACION} días hacia adelante (hasta el ${formatearFecha(fechaMaximaTurno())}).`;
    }
    return null;
}

const horaYaPaso = (fecha, hora) => fecha === hoyISO() && hora <= ahoraHora();

const MENSAJE_HORA_PASADA = 'Ese horario de hoy ya pasó. Elegí una hora más tarde.';

// Errores de una fecha + hora (un turno nuevo o reprogramado)
function erroresFechaYHora(fecha, hora, textoHora, choque, profesional) {
    const errores = {};
    const errorFecha = errorDeFecha(fecha);
    if (errorFecha) {
        errores.fecha = [errorFecha];
    }
    if (!hora) {
        errores.hora = [textoHora ? MENSAJE_HORA_INVALIDA : 'Indicá la hora.'];
    } else if (!errorFecha && horaYaPaso(fecha, hora)) {
        errores.hora = [MENSAJE_HORA_PASADA];
    } else if (!errorFecha && choque) {
        const pisado = choque(fecha, hora)[0];
        if (pisado) {
            errores.hora = [textoChoque(pisado, profesional)];
        }
    }
    return errores;
}

// En "Varias fechas" el campo de fecha está oculto: los errores de fecha que devuelve
// la API se muestran debajo del calendario (name="turnos").
function erroresEnElCalendario(error) {
    if (!(error instanceof ApiError) || !error.esDeValidacion) {
        return error;
    }
    const cuerpo = { non_field_errors: error.erroresGenerales };
    for (const [clave, mensajes] of Object.entries(error.erroresDeCampo)) {
        const destino = clave.startsWith('fecha') || clave.startsWith('turnos') ? 'turnos' : clave;
        cuerpo[destino] = [...(cuerpo[destino] ?? []), ...mensajes];
    }
    if (error.cuerpo?.detail) {
        cuerpo.detail = error.cuerpo.detail;
    }
    return new ApiError(error.status, cuerpo);
}

// Si el elemento con el foco desapareció (el botón usado se redibujó), el foco va a "destino"
function enfocarSiSePerdio(destino) {
    const activo = document.activeElement;
    if (destino && (!activo || activo === document.body || !activo.isConnected)) {
        destino.tabIndex = -1;
        destino.focus();
    }
}

const alCerrar = (modal) => new Promise((resolver) => {
    modal.addEventListener('hidden.bs.modal', resolver, { once: true });
});

// ------------------------------------------------------------
// Acciones: nuevo turno, reprogramar, cancelar
// ------------------------------------------------------------
// alCambiar: vuelve a mostrar los turnos (devuelve una Promise).
// focoTrasCambio: a dónde va el foco si el botón usado desaparece al redibujar.
export function prepararTurnos({ usuario, alCambiar, focoTrasCambio = () => null }) {
    usuarioActual = usuario;
    const deProfesional = esProfesional(usuario);

    const modalSesion = prepararModalSesion({
        usuario,
        alGuardar: alCambiar,
    });

    // ---- Nuevo turno: una fecha o varias (RF-15)
    const formulario = $('form-turno');
    const contenedorCalendario = $('turno-selector-fechas');
    const modalNuevo = $('modal-turno');
    const paciente = crearCombobox($('turno-paciente'), {
        buscar: sugerirPacientesActivos,
        minimo: 1,
        mensajeVacio: deProfesional
            ? 'No encontramos pacientes activos tuyos con ese nombre o DNI.'
            : 'No encontramos pacientes activos con ese nombre o DNI.',
    });
    const hora = crearComboboxHora($('turno-hora'));
    // Un profesional agenda para sí mismo; un administrador elige el profesional
    const profesional = deProfesional ? null : crearCombobox($('turno-profesional-elegir'), {
        buscar: sugerirProfesionales,
        minimo: 1,
        mensajeVacio: 'No encontramos profesionales con ese nombre.',
    });
    $('turno-profesional-campo').hidden = deProfesional;
    $('turno-profesional-fijo').hidden = !deProfesional;
    if (deProfesional) {
        $('turno-profesional').textContent = `${nombreCompleto(usuario.profesional)} (vos)`;
    }
    const calendario = crearSelectorFechas(contenedorCalendario, {
        desde: hoyISO(),
        hasta: fechaMaximaTurno(),
        // Al tocar un día se borra el error de las fechas, como al escribir en un campo
        alCambiar: () => {
            contenedorCalendario.classList.remove('is-invalid');
            formulario.querySelector('#turno-selector-fechas ~ [data-error-de-campo]')?.remove();
        },
    });
    const modoVarios = () => $('turno-modo-varios').checked;
    const actualizarModo = () => {
        $('turno-una-fecha').hidden = modoVarios();
        $('turno-varias-fechas').hidden = !modoVarios();
    };
    let inicial = {};

    const obtenerModalNuevo = prepararModal({
        modal: modalNuevo,
        formulario,
        contenedorErrores: $('form-turno-errores'),
        comboboxes: [paciente, hora, profesional].filter(Boolean),
        alAbrir: () => {
            const fecha = $('turno-fecha');
            fecha.min = hoyISO();
            fecha.max = fechaMaximaTurno();
            fecha.value = inicial.fecha && inicial.fecha >= hoyISO() && inicial.fecha <= fecha.max ? inicial.fecha : hoyISO();
            calendario.limpiar();
            actualizarModo();
            if (inicial.paciente) {
                paciente.elegir(opcionPaciente(inicial.paciente));
            }
        },
    });
    // Con el paciente ya elegido (desde su ficha), el foco va al primer dato que falta
    modalNuevo.addEventListener('shown.bs.modal', () => {
        if (inicial.paciente) {
            $('turno-fecha').focus();
        }
    });
    formulario.elements.modo.forEach((opcion) => opcion.addEventListener('change', actualizarModo));

    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        const varios = modoVarios();
        const fechas = varios ? calendario.fechas() : [formulario.elements.fecha.value];
        const datos = {
            paciente: paciente.valor(),
            hora: normalizarHora(hora.valor()),
            ...(deProfesional ? {} : { profesional: profesional.valor() }),
        };
        const idProfesional = deProfesional ? usuario.profesional.id : datos.profesional;
        const choque = (f, h) => turnosQueSePisan(f, h, { profesional: idProfesional, paciente: datos.paciente });

        let errores = {};
        if (!varios) {
            errores = erroresFechaYHora(fechas[0], datos.hora, hora.valor(), choque, idProfesional);
        } else {
            if (!datos.hora) {
                errores.hora = [hora.valor() ? MENSAJE_HORA_INVALIDA : 'Indicá la hora.'];
            }
            if (fechas.length === 0) {
                errores.turnos = ['Tocá en el calendario los días en los que querés dar turno.'];
            } else if (datos.hora && fechas.some((f) => horaYaPaso(f, datos.hora))) {
                errores.turnos = ['A esa hora, el turno de hoy ya pasó. Sacá el día de hoy o elegí una hora más tarde.'];
            } else if (datos.hora) {
                const pisadas = fechas.filter((f) => choque(f, datos.hora).length > 0);
                if (pisadas.length > 0) {
                    errores.turnos = [`${deProfesional ? 'Ya tenés' : 'Hay'} un turno a esa hora el ${pisadas.map(formatearFecha).join(', el ')}. `
                        + 'Sacá esas fechas o elegí otra hora.'];
                }
            }
        }
        if (!datos.paciente) {
            errores.paciente = [$('turno-paciente').value.trim() ? 'Elegí el paciente de la lista de sugerencias.' : 'Indicá el paciente.'];
        }
        if (!deProfesional && !datos.profesional) {
            errores.profesional = [$('turno-profesional-elegir').value.trim()
                ? 'Elegí el profesional de la lista de sugerencias.'
                : 'Indicá el profesional.'];
        }

        // Un turno: { paciente, fecha, hora }. Varios: { paciente, turnos: [{ fecha, hora }] }
        // (la API los crea todos o ninguno). Un profesional no manda "profesional": la API usa el logueado.
        const { hora: horaElegida, ...resto } = datos;
        const cuerpo = varios
            ? { ...resto, turnos: fechas.map((fecha) => ({ fecha, hora: horaElegida })) }
            : { ...datos, fecha: fechas[0] };

        guardar({
            formulario,
            contenedorErrores: $('form-turno-errores'),
            boton: $('btn-guardar-turno'),
            errores,
            enviar: async () => {
                try {
                    return await turnos.crear(cuerpo);
                } catch (error) {
                    throw varios ? erroresEnElCalendario(error) : error;
                }
            },
            mensajeExito: fechas.length > 1 ? `Se agendaron ${fechas.length} turnos.` : 'El turno quedó agendado.',
            modal: obtenerModalNuevo,
            alGuardar: () => alCambiar(),
        });
    });

    // ---- Reprogramar: nueva fecha y hora
    const formularioReprogramar = $('form-reprogramar');
    const modalReprogramar = $('modal-reprogramar');
    const horaReprogramar = crearComboboxHora($('reprogramar-hora'));
    let turnoAReprogramar = null;

    const obtenerModalReprogramar = prepararModal({
        modal: modalReprogramar,
        formulario: formularioReprogramar,
        contenedorErrores: $('form-reprogramar-errores'),
        comboboxes: [horaReprogramar],
        alAbrir: () => {
            const turno = turnoAReprogramar;
            const fecha = $('reprogramar-fecha');
            fecha.min = hoyISO();
            fecha.max = fechaMaximaTurno();
            fecha.value = turno.fecha;
            $('reprogramar-hora').value = formatearHora(turno.hora);
            renderizar($('reprogramar-detalle'), html`
                Turno de <strong>${nombrePaciente(turno)}</strong>${deProfesional ? '' : html` con <strong>${nombreProfesional(turno)}</strong>`}:
                ${diaEnTexto(turno.fecha)} a las ${formatearHora(turno.hora)}.`);
        },
    });

    formularioReprogramar.addEventListener('submit', (evento) => {
        evento.preventDefault();
        const turno = turnoAReprogramar;
        const datos = {
            fecha: formularioReprogramar.elements.fecha.value,
            hora: normalizarHora(horaReprogramar.valor()),
        };
        const errores = erroresFechaYHora(datos.fecha, datos.hora, horaReprogramar.valor(), (f, h) => turnosQueSePisan(f, h, {
            profesional: turno.profesional_id,
            paciente: turno.paciente_id,
            excepto: turno.id_turno,
        }), turno.profesional_id);
        if (Object.keys(errores).length === 0 && datos.fecha === turno.fecha && datos.hora === formatearHora(turno.hora)) {
            errores.fecha = ['Elegí una fecha o una hora distinta a la actual.'];
        }
        const cerrado = alCerrar(modalReprogramar);

        guardar({
            formulario: formularioReprogramar,
            contenedorErrores: $('form-reprogramar-errores'),
            boton: $('btn-guardar-reprogramar'),
            errores,
            enviar: () => turnos.reprogramar(turno.id_turno, datos),
            mensajeExito: `El turno quedó para el ${diaEnTexto(datos.fecha)} a las ${datos.hora}.`,
            modal: obtenerModalReprogramar,
            // El botón "Reprogramar" se redibuja: cuando el modal termina de cerrarse
            // y la lista se actualizó, el foco va a la lista
            alGuardar: () => Promise.all([alCambiar(), cerrado]).then(() => enfocarSiSePerdio(focoTrasCambio())),
        });
    });

    // ---- Cancelar, con confirmación
    async function cancelar(turno, boton) {
        const quien = nombrePaciente(turno);
        const aceptado = await confirmar({
            titulo: '¿Cancelar el turno?',
            mensaje: html`<p class="mb-0">Turno de <strong>${quien}</strong>:
                ${diaEnTexto(turno.fecha)} a las ${formatearHora(turno.hora)}.</p>`,
            textoAceptar: 'Sí, cancelar el turno',
            textoCancelar: 'No, volver',
            peligro: true,
        });
        if (!aceptado) {
            return;
        }
        boton.disabled = true;
        try {
            await turnos.cancelar(turno.id_turno);
        } catch (error) {
            boton.disabled = false;
            notificarError(error);
            return;
        }
        notificar(`Se canceló el turno de ${quien}.`);
        await alCambiar();
        enfocarSiSePerdio(focoTrasCambio());
    }

    // ---- Cambios de estado. Confirmar es directo; realizado y ausente piden confirmación
    // (realizado no se puede deshacer).
    const CAMBIOS_DE_ESTADO = {
        confirmar: {
            estado: ESTADO_TURNO.CONFIRMADO,
            exito: (quien) => `Se confirmó el turno de ${quien}.`,
        },
        realizado: {
            estado: ESTADO_TURNO.REALIZADO,
            pregunta: '¿Marcar el turno como realizado?',
            aclaracion: 'La sesión se hizo. Después no se puede cambiar.',
            textoAceptar: 'Sí, se realizó',
            exito: (quien) => `El turno de ${quien} quedó como realizado.`,
        },
        ausente: {
            estado: ESTADO_TURNO.AUSENTE,
            pregunta: '¿Marcar el turno como ausente?',
            aclaracion: 'El paciente no vino a la sesión.',
            textoAceptar: 'Sí, no vino',
            exito: (quien) => `El turno de ${quien} quedó como ausente.`,
        },
    };

    async function cambiarEstado(turno, botonUsado, cambio) {
        const quien = nombrePaciente(turno);
        if (cambio.pregunta) {
            const aceptado = await confirmar({
                titulo: cambio.pregunta,
                mensaje: html`<p class="mb-2">Turno de <strong>${quien}</strong>:
                    ${diaEnTexto(turno.fecha)} a las ${formatearHora(turno.hora)}.</p>
                    <p class="mb-0">${cambio.aclaracion}</p>`,
                textoAceptar: cambio.textoAceptar,
                textoCancelar: 'No, volver',
            });
            if (!aceptado) {
                return;
            }
        }
        botonUsado.disabled = true;
        try {
            await turnos.cambiarEstado(turno.id_turno, cambio.estado);
        } catch (error) {
            botonUsado.disabled = false;
            notificarError(error);
            return;
        }
        notificar(cambio.exito(quien));
        await alCambiar();
        enfocarSiSePerdio(focoTrasCambio());
        if (cambio.estado === ESTADO_TURNO.REALIZADO && modalSesion) {
            modalSesion.abrirSesion(turno);
        }
    }

    return {
        abrirNuevo({ fecha = null, paciente: pacienteInicial = null } = {}) {
            inicial = { fecha, paciente: pacienteInicial };
            obtenerModalNuevo().show();
        },
        abrirSesion(turno) {
            modalSesion.abrirSesion(turno);
        },
        abrirPendientes() {
            modalSesion.abrirPendientes?.();
        },
        // Botones de las listas de turnos dentro de "contenedor"
        // (Confirmar, Marcar realizado, Marcar ausente, Reprogramar, Cancelar)
        escuchar(contenedor) {
            contenedor.addEventListener('click', (evento) => {
                const botonUsado = evento.target.closest('[data-accion][data-turno]');
                const turno = botonUsado && turnosPorId.get(Number(botonUsado.dataset.turno));
                if (!turno) {
                    return;
                }
                const accion = botonUsado.dataset.accion;
                if (accion === 'reprogramar') {
                    turnoAReprogramar = turno;
                    obtenerModalReprogramar().show();
                } else if (accion === 'cancelar') {
                    cancelar(turno, botonUsado);
                } else if (accion === 'sesion') {
                    modalSesion.abrirSesion(turno);
                } else if (CAMBIOS_DE_ESTADO[accion]) {
                    cambiarEstado(turno, botonUsado, CAMBIOS_DE_ESTADO[accion]);
                }
            });
        },
    };
}
