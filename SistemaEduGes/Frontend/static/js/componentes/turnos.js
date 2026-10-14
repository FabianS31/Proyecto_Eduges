// ============================================================
// EduGes - Turnos: lo común a Inicio, Turnos y la ficha del paciente
//
//   - Datos: obtenerTurnos() → turnos con el paciente (y el profesional, para los administradores)
//   - Presentación: itemTurno(), badgeEstadoTurno(), formatearHora(), diaEnTexto()…
//   - Acciones: prepararTurnos() arma los modales de templates/componentes/modales_turno.html
//     (Nuevo turno, Reprogramar) y la cancelación con confirmación.
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
import { crearSelectorFechas } from './selector-fechas.js';
import {
    ESTADO_TURNO,
    PERMISO,
    TURNO_DIAS_ANTICIPACION,
    TURNO_DURACION_MINUTOS,
} from '../constantes.js';
import { pacientes, profesionales, turnos } from '../endpoints.js';
import { aFecha, hoyISO, sumarDias } from '../fechas.js';
import { esProfesional, tienePermiso } from '../layout.js';
import {
    confirmar,
    formatearFecha,
    html,
    nombreCompleto,
    notificar,
    notificarError,
    renderizar,
} from '../ui.js';

const $ = (id) => document.getElementById(id);

let usuarioActual = null;
let turnosPorId = new Map();

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

// Pendiente o confirmado: todavía se puede atender, reprogramar o cancelar
export const estaActivo = (turno) => [ESTADO_TURNO.PENDIENTE, ESTADO_TURNO.CONFIRMADO].includes(turno.estado);

export const yaEmpezo = (turno) => turno.fecha < hoyISO()
    || (turno.fecha === hoyISO() && formatearHora(turno.hora) <= ahoraHora());

const FORMATO_DIA = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

// "martes 6 de octubre" (sin coma ni año)
export const diaEnTexto = (fecha) => FORMATO_DIA.format(aFecha(fecha)).replace(',', '');

export const conMayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

// La API devuelve solo los IDs: los nombres salen de las listas de pacientes y profesionales.
// Si no están (ej.: el paciente ya no está asignado a este profesional), se muestra el número.
export function nombrePaciente(turno, opciones) {
    return turno.paciente ? nombreCompleto(turno.paciente, opciones) : `Paciente N° ${turno.paciente_id}`;
}

export function nombreProfesional(turno) {
    return turno.profesional ? nombreCompleto(turno.profesional) : `Profesional N° ${turno.profesional_id}`;
}

// Estado del turno: siempre con ícono y texto, no solo color
const ESTILO_ESTADO_TURNO = {
    [ESTADO_TURNO.PENDIENTE]: { clase: 'badge-turno-pendiente', icono: 'bi-hourglass-split' },
    [ESTADO_TURNO.CONFIRMADO]: { clase: 'badge-turno-confirmado', icono: 'bi-check2' },
    [ESTADO_TURNO.CANCELADO]: { clase: 'badge-turno-cancelado', icono: 'bi-x-lg' },
    [ESTADO_TURNO.REALIZADO]: { clase: 'badge-turno-realizado', icono: 'bi-check2-all' },
};

export function badgeEstadoTurno(estadoTurno) {
    const estilo = ESTILO_ESTADO_TURNO[estadoTurno] ?? { clase: 'bg-secondary', icono: 'bi-question' };
    return html`<span class="badge badge-turno ${estilo.clase}">
        <i class="bi ${estilo.icono} me-1" aria-hidden="true"></i>${estadoTurno ?? 'Sin estado'}</span>`;
}

export const urlPaciente = (id) => `/pacientes/?paciente=${encodeURIComponent(id)}`;

const puedeEditar = () => tienePermiso(usuarioActual, PERMISO.TURNOS_EDITAR);

function botonesTurno(turno, descripcion) {
    if (!usuarioActual || !puedeEditar() || !estaActivo(turno) || yaEmpezo(turno)) {
        return null;
    }
    return html`
        <button type="button" class="btn btn-sm btn-outline-primary" data-accion="reprogramar" data-turno="${turno.id_turno}"
                aria-label="Reprogramar ${descripcion}">
            <i class="bi bi-calendar2-range me-1" aria-hidden="true"></i>Reprogramar
        </button>
        <button type="button" class="btn btn-sm btn-outline-danger" data-accion="cancelar" data-turno="${turno.id_turno}"
                aria-label="Cancelar ${descripcion}">
            <i class="bi bi-x-circle me-1" aria-hidden="true"></i>Cancelar
        </button>`;
}

// Un turno en una lista (<li>): hora, quién, estado y acciones con texto visible.
//   conPaciente: el nombre del paciente es lo principal (agendas); si no, la fecha (ficha del paciente)
//   conProfesional: muestra con quién es el turno (administradores)
export function itemTurno(turno, { conPaciente = true, conProfesional = false } = {}) {
    const paciente = nombrePaciente(turno, { apellidoPrimero: true });
    const principal = conPaciente ? paciente : conMayuscula(diaEnTexto(turno.fecha));
    const descripcion = conPaciente
        ? `el turno de ${paciente} de las ${formatearHora(turno.hora)}`
        : `el turno del ${diaEnTexto(turno.fecha)} a las ${formatearHora(turno.hora)}`;
    return html`
        <li class="list-group-item py-3">
            <div class="d-flex align-items-center gap-3 flex-wrap">
                <div class="dashboard-hora">${formatearHora(turno.hora)}</div>
                <div class="flex-grow-1 min-w-0">
                    <span class="fw-semibold d-block text-truncate">${principal}</span>
                    ${conProfesional && html`<span class="small text-muted d-block text-truncate">Con ${nombreProfesional(turno)}</span>`}
                    ${badgeEstadoTurno(turno.estado)}
                </div>
                <div class="d-flex gap-2 flex-wrap">
                    ${conPaciente && turno.paciente && html`
                        <a href="${urlPaciente(turno.paciente_id)}" class="btn btn-sm btn-light border text-primary"
                           aria-label="Ver ficha de ${paciente}">
                            <i class="bi bi-person-lines-fill me-1" aria-hidden="true"></i>Ver ficha
                        </a>`}
                    ${botonesTurno(turno, descripcion)}
                </div>
            </div>
        </li>`;
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
        .map((t) => ({
            ...t,
            paciente: pacientesPorId.get(t.paciente_id) ?? null,
            profesional: yo ?? profesionalesPorId.get(t.profesional_id) ?? null,
        }))
        .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
    turnosPorId = new Map(completos.map((t) => [t.id_turno, t]));
    return completos;
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

    // ---- Nuevo turno: una fecha o varias (RF-15)
    const formulario = $('form-turno');
    const contenedorCalendario = $('turno-selector-fechas');
    const modalNuevo = $('modal-turno');
    const paciente = crearCombobox($('turno-paciente'), {
        buscar: sugerirPacientes,
        minimo: 1,
        mensajeVacio: mensajeSinPacientes(),
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

    return {
        abrirNuevo({ fecha = null, paciente: pacienteInicial = null } = {}) {
            inicial = { fecha, paciente: pacienteInicial };
            obtenerModalNuevo().show();
        },
        // Botones Reprogramar / Cancelar de las listas de turnos dentro de "contenedor"
        escuchar(contenedor) {
            contenedor.addEventListener('click', (evento) => {
                const boton = evento.target.closest('[data-accion][data-turno]');
                const turno = boton && turnosPorId.get(Number(boton.dataset.turno));
                if (!turno) {
                    return;
                }
                if (boton.dataset.accion === 'reprogramar') {
                    turnoAReprogramar = turno;
                    obtenerModalReprogramar().show();
                } else if (boton.dataset.accion === 'cancelar') {
                    cancelar(turno, boton);
                }
            });
        },
    };
}
