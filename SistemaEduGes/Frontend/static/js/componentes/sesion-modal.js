// ============================================================
// EduGes - Modal de Registro de Sesiones Clínicas
// (templates/componentes/modal_sesion.html)
// Maneja el alta, edición y consulta de notas de evolución (APIs/sesiones/).
//
// Reglas de negocio y privacidad:
//   - Profesional asignado / SuperAdmin:
//       * Crea registro inicial (POST /api/sesiones/)
//       * Consulta datos completos (GET /api/sesiones/<turno_id>/): trabajo, diagnóstico y notas
//       * Modifica registro existente (PATCH /api/sesiones/<turno_id>/)
//   - Administrador:
//       * Consulta solo lectura de "diagnostico" (GET /api/sesiones/<turno_id>/)
//       * No tiene acceso a "trabajo_sesion" ni "nota_sesion" (secreto profesional)
//       * No puede crear ni editar (botones ocultos)
//   - Validación: diagnóstico obligatorio
// ============================================================

import { ApiError } from '../api.js';
import { ESTADO_TURNO } from '../constantes.js';
import { sesiones, turnos } from '../endpoints.js';
import { guardar, prepararModal } from './formularios.js';
import { formatearFecha, html, icono, nombreCompleto, renderizar } from '../ui.js';
import { formatearHora } from './turnos.js';

const $ = (id) => document.getElementById(id);

export function prepararModalSesion({ usuario, alGuardar } = {}) {
    const modalElemento = $('modal-sesion');
    const formulario = $('form-sesion');
    const contenedorErrores = $('form-sesion-errores');

    const modalPendientesElemento = $('modal-sesiones-pendientes');
    const formFiltrosPendientes = $('form-filtros-pendientes');
    const btnLimpiarFiltrosPend = $('btn-limpiar-filtros-pend');

    if (!modalElemento || !formulario) {
        return {
            abrirSesion: () => console.warn('Modal de sesión no encontrado en el DOM.'),
            abrirPendientes: () => console.warn('Modal de pendientes no encontrado en el DOM.'),
        };
    }

    const turnoIdInput = $('sesion-turno-id');
    const trabajoInput = $('sesion-trabajo');
    const diagnosticoInput = $('sesion-diagnostico') || $('sesion-resultado');
    const notaInput = $('sesion-nota-sesion') || $('sesion-nota-especial');

    const seccionTrabajo = $('sesion-seccion-trabajo');
    const seccionDiagnostico = $('sesion-seccion-diagnostico');
    const seccionNota = $('sesion-seccion-nota');
    const camposClinicos = $('sesion-campos-clinicos');
    const avisoAdmin = $('sesion-aviso-admin');
    const ayudaObligatorios = $('sesion-ayuda-obligatorios');
    const cargando = $('sesion-cargando');
    const camposWrapper = $('sesion-campos');

    const tituloTexto = $('modal-sesion-titulo-texto');
    const btnGuardar = $('btn-guardar-sesion');
    const btnGuardarTexto = $('btn-guardar-sesion-texto');

    let turnoActual = null;
    let modo = 'lectura'; // 'creacion' | 'edicion' | 'lectura'
    let cargaValida = false;
    let listaPendientesActual = [];
    let peticionCargaActual = 0;

    const rolNombre = usuario?.rol?.nombre ?? usuario?.rol ?? '';
    const esAdmin = rolNombre === 'Administrador';

    function actualizarIndicadorReunion() {
        const indicador = $('sesion-reunion-identificada');
        if (indicador) indicador.hidden = esAdmin || !cargaValida || !turnoActual
            || !/^Reunión con (?:tutor|padre\/madre o tutor)(?:\r?\n|$)/.test(trabajoInput?.value.trim() ?? '');
    }

    trabajoInput?.addEventListener('input', actualizarIndicadorReunion);

    $('sesion-insertar-reunion')?.addEventListener('click', () => {
        if (esAdmin || !cargaValida || !turnoActual || !['creacion', 'edicion'].includes(modo)
            || !trabajoInput || trabajoInput.value.trim() || btnGuardar?.disabled) return;
        trabajoInput.value = 'Reunión con padre/madre o tutor\nParticipante y vínculo: \nModalidad (presencial o virtual): \nTemas tratados: \nAcuerdos y seguimiento: ';
        actualizarIndicadorReunion();
        trabajoInput.focus();
    });

    const obtenerModal = prepararModal({
        modal: modalElemento,
        formulario,
        contenedorErrores,
        alAbrir: () => {
            renderizar(contenedorErrores, '');
        },
    });

    // Al cerrar el modal, invalidamos cargas asíncronas en vuelo y limpiamos turnoActual
    modalElemento?.addEventListener('hidden.bs.modal', () => {
        peticionCargaActual++;
        turnoActual = null;
        cargaValida = false;
        modo = 'lectura';
        actualizarIndicadorReunion();
    });

    const obtenerModalPendientes = modalPendientesElemento
        ? () => window.bootstrap.Modal.getOrCreateInstance(modalPendientesElemento)
        : () => null;

    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        if (esAdmin || !cargaValida || !turnoActual || (cargando && !cargando.hidden)) {
            return; // Administrador solo consulta; bloquear envíos sin una carga válida o durante la carga
        }

        const datos = {
            turno_id: turnoActual?.id_turno ?? turnoActual?.id,
            trabajo_sesion: trabajoInput ? trabajoInput.value.trim() : '',
            diagnostico: diagnosticoInput ? diagnosticoInput.value.trim() : '',
            nota_sesion: notaInput ? notaInput.value.trim() : '',
        };

        const errores = {};
        if (!datos.trabajo_sesion) {
            errores.trabajo_sesion = ['Describí las actividades realizadas en la sesión.'];
        }

        if (!datos.diagnostico) {
            errores.diagnostico = ['El diagnóstico de la sesión es obligatorio.'];
        }

        const esCreacion = modo === 'creacion';
        const turnoId = datos.turno_id;

        let sePudoPasarARealizado = true;

        guardar({
            formulario,
            contenedorErrores,
            boton: btnGuardar,
            errores,
            enviar: async () => {
                const res = esCreacion
                    ? await sesiones.crear(datos)
                    : await sesiones.actualizar(turnoId, {
                        trabajo_sesion: datos.trabajo_sesion,
                        diagnostico: datos.diagnostico,
                        nota_sesion: datos.nota_sesion,
                    });
                // Si el turno estaba Confirmado, intentamos pasarlo a Realizado automáticamente
                const estadoId = turnoActual?.estado?.id ?? turnoActual?.estado?.ID_EstadoTurno;
                sePudoPasarARealizado = true;
                if (estadoId === ESTADO_TURNO.CONFIRMADO) {
                    try {
                        await turnos.cambiarEstado(turnoId, ESTADO_TURNO.REALIZADO);
                        sePudoPasarARealizado = true;
                    } catch {
                        // El backend no permite pasar a Realizado hasta que transcurran los 40 min del turno
                        sePudoPasarARealizado = false;
                    }
                }
                return res;
            },
            mensajeExito: () => {
                const estadoId = turnoActual?.estado?.id ?? turnoActual?.estado?.ID_EstadoTurno;
                if (estadoId === ESTADO_TURNO.CONFIRMADO && !sePudoPasarARealizado) {
                    return 'Nota clínica guardada. El turno permanece como Confirmado (podés marcarlo como Realizado manualmente).';
                }
                return esCreacion
                    ? 'Registro de sesión creado correctamente.'
                    : 'Registro de sesión actualizado correctamente.';
            },
            modal: obtenerModal,
            alGuardar: (resultadoApi) => {
                alGuardar?.(resultadoApi, turnoActual);
                // Si la ventana de pendientes está abierta o visible, refrescarla
                if (modalPendientesElemento?.classList.contains('show')) {
                    cargarPendientes();
                }
            },
        });
    });

    async function abrirSesion(turno) {
        cargaValida = false;
        modo = 'lectura';
        turnoActual = turno;
        actualizarIndicadorReunion();
        const turnoId = turno?.id_turno ?? turno?.id;
        if (!turnoId) {
            console.error('Turno sin ID para registro de sesión', turno);
            return;
        }

        // Datos del encabezado del modal
        const nombrePac = turno.paciente ? nombreCompleto(turno.paciente) : `Paciente N° ${turno.paciente_id ?? '—'}`;
        const estadoTexto = turno.estado?.nombre ?? turno.estado?.Estado ?? 'Realizado';
        const fechaTexto = formatearFecha(turno.fecha);
        const horaTexto = formatearHora(turno.hora);
        const profTexto = turno.profesional ? nombreCompleto(turno.profesional) : (usuario?.profesional ? nombreCompleto(usuario.profesional) : '');

        $('sesion-info-paciente').textContent = nombrePac;
        $('sesion-info-estado').textContent = estadoTexto;
        $('sesion-info-fecha').textContent = fechaTexto;
        $('sesion-info-hora').textContent = `${horaTexto} hs`;

        if (profTexto) {
            $('sesion-info-profesional-wrap').hidden = false;
            $('sesion-info-profesional').textContent = profTexto;
        } else {
            $('sesion-info-profesional-wrap').hidden = true;
        }

        turnoIdInput.value = turnoId;
        if (trabajoInput) trabajoInput.value = '';
        if (diagnosticoInput) diagnosticoInput.value = '';
        if (notaInput) notaInput.value = '';
        renderizar(contenedorErrores, '');

        // Ajustar interfaz según rol:
        // El administrador SOLAMENTE puede ver "DIAGNÓSTICO" (modo sólo lectura).
        // No tiene acceso a trabajo_sesion ni nota_sesion.
        if (esAdmin) {
            if (seccionTrabajo) seccionTrabajo.hidden = true;
            if (camposClinicos) camposClinicos.hidden = true;
            if (seccionNota) seccionNota.hidden = true;
            if (seccionDiagnostico) seccionDiagnostico.hidden = false;
            if (diagnosticoInput) diagnosticoInput.readOnly = true;
            if (avisoAdmin) avisoAdmin.hidden = false;
            if (btnGuardar) btnGuardar.hidden = true;
            if (ayudaObligatorios) ayudaObligatorios.hidden = true;
        } else {
            if (seccionTrabajo) seccionTrabajo.hidden = false;
            if (camposClinicos) camposClinicos.hidden = false;
            if (seccionNota) seccionNota.hidden = false;
            if (seccionDiagnostico) seccionDiagnostico.hidden = false;
            if (trabajoInput) trabajoInput.readOnly = false;
            if (diagnosticoInput) diagnosticoInput.readOnly = false;
            if (notaInput) notaInput.readOnly = false;
            if (avisoAdmin) avisoAdmin.hidden = true;
            if (btnGuardar) btnGuardar.hidden = false;
            if (ayudaObligatorios) ayudaObligatorios.hidden = false;
        }

        // Identificador secuencial para descartar respuestas tardías (Race Condition)
        const peticionId = ++peticionCargaActual;

        // Abrir modal y mostrar estado de carga
        obtenerModal().show();
        cargando.hidden = false;
        camposWrapper.hidden = true;
        if (btnGuardar) btnGuardar.disabled = true;

        try {
            const sesionExistente = await sesiones.obtener(turnoId);
            if (peticionId !== peticionCargaActual) {
                return;
            }

            // Sesión ya registrada: modo edición / consulta
            modo = 'edicion';
            tituloTexto.textContent = esAdmin ? 'Consulta de Sesión' : 'Evolución de Sesión';
            if (btnGuardarTexto) btnGuardarTexto.textContent = 'Actualizar registro';

            if (diagnosticoInput) {
                diagnosticoInput.value = sesionExistente.diagnostico ?? '';
            }
            if (!esAdmin) {
                if (trabajoInput) trabajoInput.value = sesionExistente.trabajo_sesion ?? '';
                if (notaInput) notaInput.value = sesionExistente.nota_sesion ?? '';
            }
            cargaValida = !esAdmin;
            actualizarIndicadorReunion();
        } catch (error) {
            if (peticionId !== peticionCargaActual) {
                return;
            }
            if (error instanceof ApiError && error.status === 404) {
                // No hay registro previo: modo creación
                if (esAdmin) {
                    modo = 'lectura';
                    tituloTexto.textContent = 'Consulta de Diagnóstico';
                    if (diagnosticoInput) diagnosticoInput.value = 'Este turno aún no cuenta con un diagnóstico cargado.';
                } else {
                    modo = 'creacion';
                    tituloTexto.textContent = 'Nuevo Registro de Sesión';
                    if (btnGuardarTexto) btnGuardarTexto.textContent = 'Guardar registro';
                    cargaValida = true;
                }
            } else if (error instanceof ApiError && error.status === 403) {
                tituloTexto.textContent = 'Acceso Denegado';
                renderizar(contenedorErrores, html`
                    <div class="alert alert-danger py-2 px-3 small d-flex align-items-center gap-2 mb-0" role="alert">
                        ${icono('gpp_bad')}
                        <span>No tenés permisos para consultar ni modificar la sesión de este turno.</span>
                    </div>`);
                if (btnGuardar) btnGuardar.hidden = true;
            } else {
                renderizar(contenedorErrores, html`
                    <div class="alert alert-danger py-2 px-3 small d-flex align-items-center gap-2 mb-0" role="alert">
                        ${icono('error')}
                        <span>No se pudieron consultar los datos de la sesión. Intentá de nuevo.</span>
                    </div>`);
            }
        } finally {
            if (peticionId === peticionCargaActual) {
                cargando.hidden = true;
                camposWrapper.hidden = false;
                if (btnGuardar && !esAdmin) {
                    btnGuardar.disabled = !cargaValida;
                }
            }
        }
    }

    // ------------------------------------------------------------
    // Gestión de Turnos Pendientes de Registro (/api/sesiones/pendientes/)
    // ------------------------------------------------------------
    async function cargarPendientes() {
        if (!modalPendientesElemento) return;
        const spinner = $('pendientes-cargando');
        const tablaWrap = $('pendientes-tabla-wrap');
        const vacio = $('pendientes-vacio');
        const tbody = $('pendientes-tabla-cuerpo');

        if (spinner) spinner.hidden = false;
        if (tablaWrap) tablaWrap.hidden = true;
        if (vacio) vacio.hidden = true;

        const fDesde = $('pend-fecha-desde')?.value || undefined;
        const fHasta = $('pend-fecha-hasta')?.value || undefined;
        const pacId = $('pend-paciente-id')?.value || undefined;

        try {
            const lista = await sesiones.pendientes({
                fecha_desde: fDesde,
                fecha_hasta: fHasta,
                paciente_id: pacId,
            });
            listaPendientesActual = lista || [];

            if (listaPendientesActual.length === 0) {
                if (vacio) vacio.hidden = false;
            } else {
                if (tbody) {
                    renderizar(tbody, html`
                        ${listaPendientesActual.map((item) => {
                            const pac = item.paciente ? nombreCompleto(item.paciente) : `Paciente N° ${item.paciente?.id ?? '—'}`;
                            const estadoNombre = item.estado?.nombre ?? item.estado?.Estado ?? 'Sin sesión';
                            return html`
                                <tr>
                                    <td class="fw-semibold">${formatearFecha(item.fecha)}</td>
                                    <td>${formatearHora(item.hora)} hs</td>
                                    <td><strong>${pac}</strong></td>
                                    <td><span class="badge bg-light text-dark border">${estadoNombre}</span></td>
                                    <td class="text-end">
                                        <button type="button" class="btn btn-sm btn-eduges py-0 px-2 d-inline-flex align-items-center gap-1"
                                                data-accion="cargar-sesion" data-turno-id="${item.id}">
                                            ${icono('edit_note')}Cargar notas
                                        </button>
                                    </td>
                                </tr>
                            `;
                        })}
                    `);
                }
                if (tablaWrap) tablaWrap.hidden = false;
            }
        } catch (error) {
            console.error('Error al cargar pendientes de sesión:', error);
            if (tbody) {
                renderizar(tbody, html`<tr><td colspan="5" class="text-center text-danger py-3">Error al consultar los turnos pendientes.</td></tr>`);
            }
            if (tablaWrap) tablaWrap.hidden = false;
        } finally {
            if (spinner) spinner.hidden = true;
        }
    }

    if (formFiltrosPendientes) {
        formFiltrosPendientes.addEventListener('submit', (e) => {
            e.preventDefault();
            cargarPendientes();
        });
    }

    if (btnLimpiarFiltrosPend) {
        btnLimpiarFiltrosPend.addEventListener('click', () => {
            if ($('pend-fecha-desde')) $('pend-fecha-desde').value = '';
            if ($('pend-fecha-hasta')) $('pend-fecha-hasta').value = '';
            if ($('pend-paciente-id')) $('pend-paciente-id').value = '';
            cargarPendientes();
        });
    }

    if (modalPendientesElemento) {
        modalPendientesElemento.addEventListener('click', (evento) => {
            const btn = evento.target.closest('[data-accion="cargar-sesion"]');
            if (!btn) return;
            const turnoId = Number(btn.dataset.turnoId);
            const turnoEncontrado = listaPendientesActual.find((t) => t.id === turnoId);
            if (turnoEncontrado) {
                const modalPend = obtenerModalPendientes();
                modalPend?.hide();
                abrirSesion({
                    id_turno: turnoEncontrado.id,
                    fecha: turnoEncontrado.fecha,
                    hora: turnoEncontrado.hora,
                    paciente: turnoEncontrado.paciente,
                    estado: turnoEncontrado.estado,
                });
            }
        });
    }

    return {
        abrirSesion,
        abrirPendientes() {
            if (modalPendientesElemento) {
                obtenerModalPendientes()?.show();
                cargarPendientes();
            }
        },
    };
}
