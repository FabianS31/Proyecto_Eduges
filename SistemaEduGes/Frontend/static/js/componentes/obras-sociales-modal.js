// ============================================================
// EduGes - Controlador del Modal de Gestión de Obras Sociales
// (templates/componentes/modal_obras_sociales.html) - Fase 4 Minuta
//
// Permite a Administradores y SuperAdministradores:
//   - Consultar el padrón de obras sociales y la cantidad de pacientes asociados.
//   - Dar de alta rápidamente nuevas coberturas (POST /api/obras-sociales/).
//   - Activar y desactivar coberturas (PATCH /api/obras-sociales/<id>/).
//   - Notificar a otros componentes (ej. formulario de pacientes) para
//     actualizar de inmediato las listas desplegables.
// ============================================================

import { ApiError } from '../api.js';
import { obrasSociales } from '../endpoints.js';
import { normalizarTexto } from '../texto.js';
import {
    bloqueError,
    botonCargando,
    html,
    icono,
    limpiarErroresFormulario,
    mostrarErroresFormulario,
    notificar,
    notificarError,
    renderizar,
} from '../ui.js';

const $ = (id) => document.getElementById(id);

let listaObrasSociales = [];
let inicializado = false;

// ============================================================
// Inicialización del Modal
// ============================================================
export function inicializarModalObrasSociales() {
    const modalEl = $('modal-obras-sociales');
    if (!modalEl || inicializado) return;

    inicializado = true;

    // Al abrir el modal, cargar o refrescar el padrón
    modalEl.addEventListener('show.bs.modal', async () => {
        limpiarFormularioAlta();
        await cargarListado();
    });

    // Filtros de búsqueda en tiempo real
    $('os-filtro-busqueda')?.addEventListener('input', () => {
        renderizarTabla();
    });

    $('os-filtro-estado')?.addEventListener('change', () => {
        renderizarTabla();
    });

    // Formulario de alta rápida
    $('form-crear-obra-social')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await guardarNuevaObraSocial();
    });

    // Delegación de clics en la tabla para cambiar estado
    $('os-tabla-cuerpo')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-accion="cambiar-estado-os"]');
        if (btn) {
            const osId = btn.dataset.osId;
            const nuevoEstado = parseInt(btn.dataset.estadoNuevo, 10);
            if (osId && nuevoEstado) {
                await cambiarEstadoObraSocial(osId, nuevoEstado);
            }
        }
    });
}

// ============================================================
// Carga del listado desde la API
// ============================================================
async function cargarListado() {
    const cargandoEl = $('os-cargando');
    const tablaContenedor = $('os-tabla-contenedor');
    const vacioEl = $('os-vacio');

    if (cargandoEl) cargandoEl.classList.remove('d-none');
    if (tablaContenedor) tablaContenedor.classList.add('d-none');
    if (vacioEl) vacioEl.classList.add('d-none');

    try {
        listaObrasSociales = await obrasSociales.listar();
        renderizarTabla();
    } catch (error) {
        console.error('Error al cargar obras sociales:', error);
        notificarError(error);
        if (vacioEl) {
            vacioEl.classList.remove('d-none');
            renderizar(vacioEl, bloqueError('No se pudo cargar el listado de obras sociales.'));
        }
    } finally {
        if (cargandoEl) cargandoEl.classList.add('d-none');
    }
}

// ============================================================
// Renderizado dinámico de la tabla y métricas
// ============================================================
function renderizarTabla() {
    const tbody = $('os-tabla-cuerpo');
    const tablaContenedor = $('os-tabla-contenedor');
    const vacioEl = $('os-vacio');
    const contadorTotal = $('os-contador-total');

    if (!tbody) return;

    const textoFiltro = normalizarTexto($('os-filtro-busqueda')?.value || '');
    const estadoFiltro = $('os-filtro-estado')?.value || '';

    // Filtrar elementos
    const filtradas = listaObrasSociales.filter((os) => {
        // Filtro por estado
        if (estadoFiltro) {
            const idEstado = os.estado?.id || (os.estado?.nombre?.toLowerCase() === 'activa' ? 1 : 2);
            if (String(idEstado) !== String(estadoFiltro)) {
                return false;
            }
        }

        // Filtro por texto
        if (textoFiltro) {
            const campos = [os.nombre, os.contacto, os.mail, os.web].filter(Boolean).join(' ');
            if (!normalizarTexto(campos).includes(textoFiltro)) {
                return false;
            }
        }

        return true;
    });

    if (contadorTotal) {
        contadorTotal.textContent = `${filtradas.length} ${filtradas.length === 1 ? 'cobertura' : 'coberturas'}`;
    }

    if (filtradas.length === 0) {
        if (tablaContenedor) tablaContenedor.classList.add('d-none');
        if (vacioEl) {
            vacioEl.classList.remove('d-none');
            vacioEl.innerHTML = `
                <span class="ms fs-2 d-block mb-1 text-muted" aria-hidden="true">search_off</span>
                No se encontraron coberturas coincidentes.
            `;
        }
        return;
    }

    if (vacioEl) vacioEl.classList.add('d-none');
    if (tablaContenedor) tablaContenedor.classList.remove('d-none');

    renderizar(tbody, filtradas.map((os) => {
        const esActiva = os.estado?.id === 1 || os.estado?.nombre?.toLowerCase() === 'activa';
        const cantPacientes = os.cantidad_pacientes ?? 0;

        return html`
            <tr>
                <td>
                    <strong class="text-dark">${os.nombre}</strong>
                    ${os.contacto || os.mail ? html`
                        <div class="text-muted small">
                            ${os.contacto ? html`<span class="me-2"><span class="ms align-middle" style="font-size: 13px;">call</span> ${os.contacto}</span>` : ''}
                            ${os.mail ? html`<span><span class="ms align-middle" style="font-size: 13px;">mail</span> ${os.mail}</span>` : ''}
                        </div>
                    ` : ''}
                    ${os.web ? html`<div class="small"><a href="${os.web}" target="_blank" rel="noopener" class="text-decoration-none small text-muted"><span class="ms align-middle" style="font-size: 13px;">link</span> Sitio web</a></div>` : ''}
                </td>
                <td>
                    <span class="badge ${cantPacientes > 0 ? 'bg-primary-subtle text-primary border border-primary-subtle' : 'bg-light text-muted border'} px-2 py-1">
                        <span class="ms align-middle me-1" style="font-size: 13px;">groups</span>
                        ${cantPacientes} ${cantPacientes === 1 ? 'paciente' : 'pacientes'}
                    </span>
                </td>
                <td>
                    <span class="eg-chip ${esActiva ? 'eg-chip--ok' : 'eg-chip--err'}">
                        ${icono(esActiva ? 'check_circle' : 'cancel')}
                        ${esActiva ? 'Activa' : 'Inactiva'}
                    </span>
                </td>
                <td class="text-end">
                    ${esActiva ? html`
                        <button type="button" class="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                                data-accion="cambiar-estado-os"
                                data-os-id="${os.id}"
                                data-estado-nuevo="2"
                                title="Desactivar esta cobertura">
                            <span class="ms ms-sm" aria-hidden="true">block</span>
                            <span>Desactivar</span>
                        </button>
                    ` : html`
                        <button type="button" class="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1"
                                data-accion="cambiar-estado-os"
                                data-os-id="${os.id}"
                                data-estado-nuevo="1"
                                title="Reactivar esta cobertura">
                            <span class="ms ms-sm" aria-hidden="true">check_circle</span>
                            <span>Reactivar</span>
                        </button>
                    `}
                </td>
            </tr>
        `;
    }));
}

// ============================================================
// Guardar nueva obra social
// ============================================================
async function guardarNuevaObraSocial() {
    const form = $('form-crear-obra-social');
    const contenedorErrores = $('form-os-errores');
    const btnGuardar = $('btn-guardar-os');
    const inputNombre = $('os-nombre');
    const inputContacto = $('os-contacto');
    const inputMail = $('os-mail');
    const inputWeb = $('os-web');

    if (!form || !btnGuardar) return;

    limpiarErroresFormulario(contenedorErrores, form);

    const nombre = inputNombre?.value.trim() || '';
    const contacto = inputContacto?.value.trim() || null;
    const mail = inputMail?.value.trim() || null;
    const web = inputWeb?.value.trim() || null;

    if (!nombre) {
        mostrarErroresFormulario(contenedorErrores, form, {
            nombre: 'Ingresá el nombre de la obra social.',
        });
        inputNombre?.focus();
        return;
    }

    botonCargando(btnGuardar, true, 'Guardando…');

    try {
        await obrasSociales.crear({
            nombre,
            contacto,
            mail,
            web,
        });

        notificar(`Obra social "${nombre}" agregada correctamente.`, 'exito');
        limpiarFormularioAlta();

        // Notificar al sistema para actualizar selectores dinámicos
        window.dispatchEvent(new CustomEvent('eduges:obras-sociales-actualizadas', {
            detail: { nombre, accion: 'creada' },
        }));

        await cargarListado();
    } catch (error) {
        console.error('Error al guardar obra social:', error);
        if (error instanceof ApiError && error.detalles) {
            mostrarErroresFormulario(contenedorErrores, form, error.detalles);
        } else {
            notificarError(error);
        }
    } finally {
        botonCargando(btnGuardar, false);
    }
}

// ============================================================
// Cambiar estado (Activa / Inactiva)
// ============================================================
async function cambiarEstadoObraSocial(id, nuevoEstado) {
    const obraSocial = listaObrasSociales.find((os) => String(os.id) === String(id));
    const nombre = obraSocial?.nombre || 'la obra social';

    if (nuevoEstado === 2) {
        const confirmar = window.confirm(
            `¿Estás seguro de que deseás desactivar "${nombre}"?\n\n` +
            `Los pacientes que ya la tienen asignada conservarán su cobertura, pero dejará de estar disponible para nuevos registros.`
        );
        if (!confirmar) return;
    }

    try {
        await obrasSociales.actualizar(id, { estado_id: nuevoEstado });

        const mensaje = nuevoEstado === 1
            ? `"${nombre}" fue reactivada exitosamente.`
            : `"${nombre}" fue desactivada correctamente.`;

        notificar(mensaje, 'exito');

        // Notificar al sistema para actualizar selectores dinámicos
        window.dispatchEvent(new CustomEvent('eduges:obras-sociales-actualizadas', {
            detail: { id, nuevoEstado, accion: 'estado_modificado' },
        }));

        await cargarListado();
    } catch (error) {
        console.error('Error al cambiar estado de obra social:', error);
        notificarError(error);
    }
}

// ============================================================
// Limpieza del formulario
// ============================================================
function limpiarFormularioAlta() {
    const form = $('form-crear-obra-social');
    const contenedorErrores = $('form-os-errores');
    if (form) form.reset();
    if (contenedorErrores) limpiarErroresFormulario(contenedorErrores, form);
}
