// ============================================================
// EduGes - Controlador del Módulo de Reportes e Informes
// (templates/reportes.html) - ERS CU11 y CA-04
//
// Reportes consolidados de Turnos, Pacientes y Profesionales.
// Permisos:
//   - Profesional: solo tiene acceso a Reporte de Turnos
//     (el backend acota la consulta a sus turnos y pacientes asignados).
//   - Administrador y SuperAdministrador: acceso total a los 3 reportes.
// ============================================================

import { buscarEnLista, crearCombobox } from '../componentes/combobox.js';
import { catalogos, pacientes, profesionales, reportes, sesiones } from '../endpoints.js';
import { edad, hoyISO } from '../fechas.js';
import { esProfesional, obtenerUsuario } from '../layout.js';
import { normalizarTexto } from '../texto.js';
import {
    badgeCud,
    bloqueCargando,
    bloqueError,
    bloqueVacio,
    botonCargando,
    enlaceMail,
    enlaceTelefono,
    estadoCud,
    formatearFecha,
    html,
    icono,
    nombreCompleto,
    notificar,
    notificarError,
    renderizar,
} from '../ui.js';

const $ = (id) => document.getElementById(id);

// Estado de la pantalla
const estado = {
    usuario: null,
    esPro: false,
    tipo: 'turnos', // 'turnos' | 'pacientes' | 'profesionales'
    filtros: {},
    resultados: [],
    totalOriginal: 0,
    profesionalesLista: [],
    obrasSocialesLista: [],
    cargando: false,
};

// Instancias de combobox para búsqueda reactiva con sugerencias
const combos = {
    turnos: null,
    pacientes: null,
    profesionales: null,
};

let listaPacientesCache = null;
let listaProfesionalesCache = null;

// ============================================================
// Proveedores de sugerencias para autocompletado (Combobox)
// ============================================================
async function obtenerPacientesOpciones() {
    if (!listaPacientesCache) {
        try {
            const todos = await pacientes.listar();
            listaPacientesCache = todos.map((p) => ({
                valor: p.id_paciente,
                texto: `${p.apellido}, ${p.nombre}`,
                detalle: `DNI ${p.dni || 'S/D'}`,
                item: p,
            }));
        } catch (error) {
            console.warn('No se pudieron precargar pacientes para autocompletado:', error);
            listaPacientesCache = [];
        }
    }
    return listaPacientesCache;
}

async function sugerirPacientes(texto) {
    const opciones = await obtenerPacientesOpciones();
    return buscarEnLista(opciones)(texto);
}

async function obtenerProfesionalesOpciones() {
    if (!listaProfesionalesCache) {
        try {
            const todos = await profesionales.listar();
            listaProfesionalesCache = todos.map((p) => ({
                valor: p.id_profesional,
                texto: `${p.apellido}, ${p.nombre}`,
                detalle: `Matrícula: ${p.matricula || 'S/D'} · ${p.especialidad?.nombre || 'General'}`,
                item: p,
            }));
        } catch (error) {
            console.warn('No se pudieron precargar profesionales para autocompletado:', error);
            listaProfesionalesCache = [];
        }
    }
    return listaProfesionalesCache;
}

async function sugerirProfesionales(texto) {
    const opciones = await obtenerProfesionalesOpciones();
    return buscarEnLista(opciones)(texto);
}

// Búsqueda tolerante a mayúsculas, minúsculas, acentos y signos de puntuación (ej: "Pérez, Lucía")
function coincideBusquedaReporte(campos, busqueda) {
    if (!busqueda || !busqueda.trim()) return true;
    const texto = normalizarTexto(campos.filter(Boolean).join(' '));
    const palabras = normalizarTexto(busqueda)
        .replace(/[,;.]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    return palabras.every((palabra) => texto.includes(palabra));
}

// ============================================================
// Inicialización del módulo
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        estado.usuario = await obtenerUsuario();
        estado.esPro = esProfesional(estado.usuario);

        configurarPermisosYRoles();
        await cargarCatalogos();
        conectarEventos();

        // Carga inicial del reporte activo (por defecto turnos)
        await consultarReporte();
    } catch (error) {
        notificarError(error);
        renderizar($('reporte-estado'), bloqueError('No se pudo inicializar el módulo de reportes.'));
    }
});

// ============================================================
// Ajuste de interfaz según rol (CU11)
// ============================================================
function configurarPermisosYRoles() {
    if (estado.esPro) {
        // Un profesional solo ve Reporte de Turnos
        const tabPacientes = $('tab-pacientes');
        const labelPacientes = $('label-tab-pacientes');
        const tabProfesionales = $('tab-profesionales');
        const labelProfesionales = $('label-tab-profesionales');

        if (tabPacientes) tabPacientes.hidden = true;
        if (labelPacientes) labelPacientes.style.display = 'none';
        if (tabProfesionales) tabProfesionales.hidden = true;
        if (labelProfesionales) labelProfesionales.style.display = 'none';

        const campoPro = $('campo-turno-profesional');
        if (campoPro) campoPro.hidden = true;

        $('reportes-subtitulo').textContent = 'Tus turnos y sesiones asignadas';
        estado.tipo = 'turnos';
    } else {
        // Administrador o SuperAdministrador: habilitar selector de profesionales
        const campoPro = $('campo-turno-profesional');
        if (campoPro) campoPro.hidden = false;
        $('reportes-subtitulo').textContent = 'Módulo de estadísticas y auditoría institucional';
    }
}

// ============================================================
// Carga de catálogos para filtros
// ============================================================
async function cargarCatalogos() {
    try {
        if (!estado.esPro) {
            // Cargar profesionales para el filtro de turnos
            estado.profesionalesLista = await profesionales.listar();
            const selectPro = $('filtro-turno-profesional');
            if (selectPro && estado.profesionalesLista.length > 0) {
                const opciones = estado.profesionalesLista.map(
                    (p) => html`<option value="${p.id_profesional}">${p.apellido}, ${p.nombre}</option>`
                );
                renderizar(selectPro, html`<option value="">Todos los profesionales</option>${opciones}`);
            }

            // Cargar obras sociales para el filtro de pacientes
            estado.obrasSocialesLista = await catalogos.obrasSociales();
            const selectOS = $('filtro-paciente-obra-social');
            if (selectOS && estado.obrasSocialesLista.length > 0) {
                const opcionesOS = estado.obrasSocialesLista.map(
                    (os) => html`<option value="${os.id}">${os.nombre}</option>`
                );
                renderizar(selectOS, html`<option value="">Todas las obras sociales</option>${opcionesOS}`);
            }
        }
    } catch (error) {
        console.warn('Aviso al cargar catálogos auxiliares:', error);
    }
}

// ============================================================
// Conexión de eventos
// ============================================================
function conectarEventos() {
    // Inicializar comboboxes con sugerencias desplegables al escribir
    const inputTurnosBusqueda = $('filtro-turno-busqueda');
    if (inputTurnosBusqueda) {
        combos.turnos = crearCombobox(inputTurnosBusqueda, {
            buscar: sugerirPacientes,
            minimo: 1,
            textoLibre: true,
            mensajeVacio: 'No se encontraron pacientes coincidentes.',
            alElegir: (opcion) => {
                if (opcion) {
                    inputTurnosBusqueda.value = opcion.texto;
                    consultarReporte();
                }
            },
        });
    }

    const inputPacientesQ = $('filtro-paciente-q');
    if (inputPacientesQ) {
        combos.pacientes = crearCombobox(inputPacientesQ, {
            buscar: sugerirPacientes,
            minimo: 1,
            textoLibre: true,
            mensajeVacio: 'No se encontraron pacientes coincidentes.',
            alElegir: (opcion) => {
                if (opcion) {
                    inputPacientesQ.value = opcion.texto;
                    consultarReporte();
                }
            },
        });
    }

    const inputProfesionalesQ = $('filtro-profesional-q');
    if (inputProfesionalesQ) {
        combos.profesionales = crearCombobox(inputProfesionalesQ, {
            buscar: sugerirProfesionales,
            minimo: 1,
            textoLibre: true,
            mensajeVacio: 'No se encontraron profesionales coincidentes.',
            alElegir: (opcion) => {
                if (opcion) {
                    inputProfesionalesQ.value = opcion.texto;
                    consultarReporte();
                }
            },
        });
    }

    // Cambio de pestaña (Tipo de reporte)
    document.querySelectorAll('input[name="tipo_reporte"]').forEach((radio) => {
        radio.addEventListener('change', async (e) => {
            if (estado.cargando) return;
            estado.tipo = e.target.value;
            actualizarVisibilidadFiltros();
            await consultarReporte();
        });
    });

    // Envío del formulario de filtros
    $('filtros-reporte').addEventListener('submit', async (e) => {
        e.preventDefault();
        await consultarReporte();
    });

    // Botón limpiar filtros
    $('btn-limpiar-filtros').addEventListener('click', async () => {
        $('filtros-reporte').reset();
        combos.turnos?.limpiar();
        combos.pacientes?.limpiar();
        combos.profesionales?.limpiar();
        await consultarReporte();
    });

    // Botón Imprimir / Guardar en PDF
    $('btn-imprimir').addEventListener('click', () => {
        actualizarMembreteImpresion();
        window.print();
    });

    // Botón Exportar CSV
    $('btn-exportar-csv').addEventListener('click', () => {
        exportarCSV(estado.tipo, estado.resultados);
    });

    // Consulta rápida de sesión clínica desde la tabla (Ítems 9 y 10 Minuta)
    $('reporte-cuerpo')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-accion="ver-sesion"]');
        if (btn) {
            const turnoId = btn.dataset.turnoId;
            if (turnoId) {
                abrirDetalleSesion(turnoId);
            }
        }
    });

    // Actualización reactiva al cambiar obras sociales desde el modal de gestión
    window.addEventListener('eduges:obras-sociales-actualizadas', async () => {
        await cargarCatalogos();
    });

    actualizarVisibilidadFiltros();
}

// ============================================================
// Modal de detalle de sesión clínica (Ítems 9, 10 y 11 Minuta)
// ============================================================
async function abrirDetalleSesion(turnoId) {
    const modalEl = $('modal-detalle-sesion-reporte');
    if (!modalEl) return;

    const bsModal = window.bootstrap?.Modal?.getOrCreateInstance(modalEl) || new bootstrap.Modal(modalEl);
    bsModal.show();

    const turno = estado.resultados.find((t) => String(t.id) === String(turnoId));

    // Llenar encabezado con los datos conocidos del turno
    if (turno) {
        $('det-sesion-paciente').textContent = turno.paciente ? `${turno.paciente.apellido}, ${turno.paciente.nombre}` : '—';
        $('det-sesion-fecha').textContent = formatearFecha(turno.fecha);
        $('det-sesion-hora').textContent = turno.hora ? `${String(turno.hora).slice(0, 5)} hs` : '—';
        $('det-sesion-profesional').textContent = turno.profesional ? `${turno.profesional.apellido}, ${turno.profesional.nombre}` : '—';
    }

    const cargandoEl = $('det-sesion-cargando');
    const errorEl = $('det-sesion-error');
    const contenidoEl = $('det-sesion-contenido');
    const trabajoEl = $('det-sesion-trabajo');
    const seccionClinicaEl = $('det-sesion-seccion-clinica');
    const resultadoEl = $('det-sesion-resultado');
    const notaEspecialEl = $('det-sesion-nota-especial');
    const avisoAdminEl = $('det-sesion-aviso-admin');

    cargandoEl.classList.remove('d-none');
    errorEl.classList.add('d-none');
    contenidoEl.classList.add('d-none');

    try {
        const sesion = await sesiones.obtener(turnoId);
        cargandoEl.classList.add('d-none');
        contenidoEl.classList.remove('d-none');

        // Trabajo de sesión (visible para todos los roles)
        trabajoEl.textContent = sesion.trabajo_sesion || 'Sin detalle de trabajo registrado.';
        if (turno && sesion.trabajo_sesion) {
            turno.trabajo_sesion = sesion.trabajo_sesion;
        }

        // Validación de secreto profesional (Ítems 9 y 10 Minuta):
        // Administrador puro solo ve el trabajo administrativo, no resultados ni notas clínicas
        const esAdminPuro = !estado.esPro && !estado.usuario?.is_superuser;
        if (esAdminPuro) {
            seccionClinicaEl.classList.add('d-none');
            avisoAdminEl.classList.remove('d-none');
        } else {
            seccionClinicaEl.classList.remove('d-none');
            avisoAdminEl.classList.add('d-none');
            resultadoEl.textContent = sesion.resultado || 'Sin registrar';
            notaEspecialEl.textContent = sesion.nota_especial || 'Sin notas especiales.';
        }
    } catch (error) {
        cargandoEl.classList.add('d-none');
        errorEl.classList.remove('d-none');
        renderizar(errorEl, bloqueError('No se encontró o no se pudo consultar el registro de sesión clínica para este turno.'));
    }
}

// ============================================================
// Visibilidad dinámica de grupos de filtros
// ============================================================
function actualizarVisibilidadFiltros() {
    const formFiltros = $('filtros-reporte');
    if (formFiltros) {
        formFiltros.dataset.tipo = estado.tipo;
    }
    document.querySelectorAll('[data-filtro-grupo]').forEach((campo) => {
        const corresponde = campo.dataset.filtroGrupo === estado.tipo;
        campo.classList.toggle('d-none', !corresponde);
    });

    // Actualizar encabezados según el reporte seleccionado
    const titulos = {
        turnos: 'Listado de Turnos y Sesiones',
        pacientes: 'Padrón General de Pacientes',
        profesionales: 'Equipo de Profesionales',
    };
    $('reporte-titulo-tabla').textContent = titulos[estado.tipo] || 'Listado detallado';
}

// ============================================================
// Consulta del reporte a la API
// ============================================================
async function consultarReporte() {
    estado.cargando = true;
    const btnSubmit = $('btn-aplicar-filtros');
    botonCargando(btnSubmit, true, 'Consultando…');

    // Mostrar placeholder de carga
    $('reporte-tabla-contenedor').classList.add('d-none');
    $('reporte-estado').classList.remove('d-none');
    renderizar($('reporte-estado'), bloqueCargando(4));
    renderizar($('reporte-kpis'), html`
        <div class="placeholder-glow w-100 py-3">
            <span class="placeholder col-12 d-block rounded py-3"></span>
        </div>
    `);

    try {
        let respuesta = { total: 0, resultados: [] };
        let textoBusqueda = '';

        if (estado.tipo === 'turnos') {
            const desde = $('filtro-turno-desde').value;
            const hasta = $('filtro-turno-hasta').value;
            const estadoId = $('filtro-turno-estado').value;
            const proId = $('filtro-turno-profesional')?.value;
            textoBusqueda = $('filtro-turno-busqueda').value.trim();
            const textoTrabajo = $('filtro-turno-trabajo')?.value.trim();

            if (desde && hasta && desde > hasta) {
                notificar('La fecha "Desde" no puede ser posterior a la fecha "Hasta".', 'error');
                botonCargando(btnSubmit, false);
                estado.cargando = false;
                $('reporte-estado').classList.add('d-none');
                return;
            }

            const queryParams = {};
            if (desde) queryParams.fecha_desde = desde;
            if (hasta) queryParams.fecha_hasta = hasta;
            if (estadoId) queryParams.estado_id = parseInt(estadoId, 10);
            if (proId && !estado.esPro) queryParams.profesional_id = parseInt(proId, 10);
            if (textoTrabajo) queryParams.trabajo_sesion = textoTrabajo;

            respuesta = await reportes.turnos(queryParams);
            let items = respuesta.resultados || [];

            // Filtrado complementario tolerante a mayúsculas/acentos
            if (textoBusqueda) {
                items = items.filter((t) =>
                    coincideBusquedaReporte(
                        [
                            t.paciente?.nombre,
                            t.paciente?.apellido,
                            t.profesional?.nombre,
                            t.profesional?.apellido,
                            t.estado?.nombre,
                        ],
                        textoBusqueda
                    )
                );
            }
            if (textoTrabajo) {
                items = items.filter((t) =>
                    coincideBusquedaReporte([t.trabajo_sesion], textoTrabajo)
                );
            }
            estado.resultados = items;
            estado.totalOriginal = respuesta.total;

        } else if (estado.tipo === 'pacientes') {
            const estadoId = $('filtro-paciente-estado').value;
            const obraSocialId = $('filtro-paciente-obra-social').value;
            const altaDesde = $('filtro-paciente-alta-desde')?.value;
            const altaHasta = $('filtro-paciente-alta-hasta')?.value;
            textoBusqueda = $('filtro-paciente-q').value.trim();

            const queryParams = {};
            if (estadoId) queryParams.estado_id = parseInt(estadoId, 10);
            if (obraSocialId) queryParams.obra_social_id = parseInt(obraSocialId, 10);
            if (altaDesde) queryParams.fecha_alta_desde = altaDesde;
            if (altaHasta) queryParams.fecha_alta_hasta = altaHasta;

            respuesta = await reportes.pacientes(queryParams);
            let items = respuesta.resultados || [];

            if (altaDesde || altaHasta) {
                items = items.filter((p) => {
                    const fAlta = p.fecha_alta || p.fecha_ingreso || p.created_at;
                    if (!fAlta) return true;
                    if (altaDesde && fAlta < altaDesde) return false;
                    if (altaHasta && fAlta > altaHasta) return false;
                    return true;
                });
            }

            if (textoBusqueda) {
                items = items.filter((p) =>
                    coincideBusquedaReporte(
                        [p.nombre, p.apellido, p.dni, p.obra_social?.nombre, p.numero_afiliado],
                        textoBusqueda
                    )
                );
            }
            estado.resultados = items;
            estado.totalOriginal = respuesta.total;

        } else if (estado.tipo === 'profesionales') {
            const espId = $('filtro-profesional-especialidad').value;
            const estadoId = $('filtro-profesional-estado').value;
            textoBusqueda = $('filtro-profesional-q').value.trim();

            const queryParams = {};
            if (espId) queryParams.especialidad_id = parseInt(espId, 10);
            if (estadoId) queryParams.estado_id = parseInt(estadoId, 10);

            respuesta = await reportes.profesionales(queryParams);
            let items = respuesta.resultados || [];

            if (textoBusqueda) {
                items = items.filter((p) =>
                    coincideBusquedaReporte(
                        [p.nombre, p.apellido, p.dni, p.matricula, p.especialidad?.nombre],
                        textoBusqueda
                    )
                );
            }
            estado.resultados = items;
            estado.totalOriginal = respuesta.total;
        }

        renderizarKPIs();
        renderizarTabla();
        actualizarMembreteImpresion();

    } catch (error) {
        console.error('Error al consultar reporte:', error);
        notificarError(error);
        renderizar($('reporte-estado'), bloqueError('No se pudo generar el reporte. Revisá los criterios o intentá de nuevo.'));
        $('reporte-estado').classList.remove('d-none');
        $('reporte-tabla-contenedor').classList.add('d-none');
    } finally {
        botonCargando(btnSubmit, false);
        estado.cargando = false;
    }
}

// ============================================================
// Renderizado de Métricas y KPIs (CA-04)
// ============================================================
function renderizarKPIs() {
    const kpisContenedor = $('reporte-kpis');
    const items = estado.resultados;

    if (estado.tipo === 'turnos') {
        const total = items.length;
        const realizados = items.filter((t) => t.estado?.id === 4).length;
        const confirmados = items.filter((t) => t.estado?.id === 2).length;
        const pendientes = items.filter((t) => t.estado?.id === 1).length;
        const cancelados = items.filter((t) => t.estado?.id === 3).length;

        renderizar(kpisContenedor, html`
            <div class="eg-stat">
                <div class="eg-stat__icon"><span class="ms" aria-hidden="true">calendar_month</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Total Turnos</span>
                    <span class="eg-stat__value">${total}</span>
                    <span class="eg-stat__sub">En el período consultado</span>
                </div>
            </div>
            <div class="eg-stat">
                <div class="eg-stat__icon eg-stat__icon--green"><span class="ms" aria-hidden="true">task_alt</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Realizados</span>
                    <span class="eg-stat__value">${realizados}</span>
                    <span class="eg-stat__sub">Sesiones completadas</span>
                </div>
            </div>
            <div class="eg-stat">
                <div class="eg-stat__icon"><span class="ms" aria-hidden="true">event_available</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Confirmados</span>
                    <span class="eg-stat__value">${confirmados}</span>
                    <span class="eg-stat__sub">Asistencia confirmada</span>
                </div>
            </div>
            <div class="eg-stat">
                <div class="eg-stat__icon eg-stat__icon--orange"><span class="ms" aria-hidden="true">schedule</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Pendientes</span>
                    <span class="eg-stat__value">${pendientes}</span>
                    <span class="eg-stat__sub">Aguardando confirmación</span>
                </div>
            </div>
            <div class="eg-stat">
                <div class="eg-stat__icon eg-stat__icon--red"><span class="ms" aria-hidden="true">event_busy</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Cancelados</span>
                    <span class="eg-stat__value">${cancelados}</span>
                    <span class="eg-stat__sub">Sesiones canceladas</span>
                </div>
            </div>
        `);

    } else if (estado.tipo === 'pacientes') {
        const total = items.length;
        const activos = items.filter((p) => p.estado?.id === 1).length;
        const inactivos = items.filter((p) => p.estado?.id === 2).length;
        const conCudAlerta = items.filter((p) => {
            if (!p.cud_vencimiento) return false;
            const c = estadoCud(p.cud_vencimiento);
            return c.clave === 'vencido' || c.clave === 'por_vencer';
        }).length;

        renderizar(kpisContenedor, html`
            <div class="eg-stat">
                <div class="eg-stat__icon"><span class="ms" aria-hidden="true">groups</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Total Pacientes</span>
                    <span class="eg-stat__value">${total}</span>
                    <span class="eg-stat__sub">Padrón consultado</span>
                </div>
            </div>
            <div class="eg-stat">
                <div class="eg-stat__icon eg-stat__icon--green"><span class="ms" aria-hidden="true">check_circle</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Activos</span>
                    <span class="eg-stat__value">${activos}</span>
                    <span class="eg-stat__sub">En tratamiento</span>
                </div>
            </div>
            <div class="eg-stat">
                <div class="eg-stat__icon"><span class="ms" aria-hidden="true">pause_circle</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Inactivos</span>
                    <span class="eg-stat__value">${inactivos}</span>
                    <span class="eg-stat__sub">De baja o pausados</span>
                </div>
            </div>
            <div class="eg-stat">
                <div class="eg-stat__icon eg-stat__icon--orange"><span class="ms" aria-hidden="true">warning</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">CUD en Alerta</span>
                    <span class="eg-stat__value">${conCudAlerta}</span>
                    <span class="eg-stat__sub">Vencidos o por vencer</span>
                </div>
            </div>
        `);

    } else if (estado.tipo === 'profesionales') {
        const total = items.length;
        const activos = items.filter((p) => p.estado_profesional?.id === 1).length;
        const inactivos = items.filter((p) => p.estado_profesional?.id === 2).length;
        const especialidadesCount = new Set(items.map((p) => p.especialidad?.nombre).filter(Boolean)).size;

        renderizar(kpisContenedor, html`
            <div class="eg-stat">
                <div class="eg-stat__icon"><span class="ms" aria-hidden="true">badge</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Total Equipo</span>
                    <span class="eg-stat__value">${total}</span>
                    <span class="eg-stat__sub">Profesionales</span>
                </div>
            </div>
            <div class="eg-stat">
                <div class="eg-stat__icon eg-stat__icon--green"><span class="ms" aria-hidden="true">verified_user</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Activos</span>
                    <span class="eg-stat__value">${activos}</span>
                    <span class="eg-stat__sub">En actividad clínica</span>
                </div>
            </div>
            <div class="eg-stat">
                <div class="eg-stat__icon"><span class="ms" aria-hidden="true">person_off</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Inactivos</span>
                    <span class="eg-stat__value">${inactivos}</span>
                    <span class="eg-stat__sub">Licencia o inactivos</span>
                </div>
            </div>
            <div class="eg-stat">
                <div class="eg-stat__icon"><span class="ms" aria-hidden="true">psychology</span></div>
                <div class="eg-stat__body">
                    <span class="eg-stat__label">Especialidades</span>
                    <span class="eg-stat__value">${especialidadesCount}</span>
                    <span class="eg-stat__sub">Áreas representadas</span>
                </div>
            </div>
        `);
    }
}

// ============================================================
// Renderizado de Tabla de Resultados
// ============================================================
function renderizarTabla() {
    const thead = $('reporte-thead');
    const tbody = $('reporte-cuerpo');
    const estadoNodo = $('reporte-estado');
    const contenedorTabla = $('reporte-tabla-contenedor');
    const items = estado.resultados;

    $('reporte-total').textContent = `${items.length} ${items.length === 1 ? 'registro' : 'registros'}`;

    if (items.length === 0) {
        contenedorTabla.classList.add('d-none');
        estadoNodo.classList.remove('d-none');
        renderizar(estadoNodo, bloqueVacio('No se encontraron registros que coincidan con los criterios seleccionados.', 'search_off'));
        return;
    }

    estadoNodo.classList.add('d-none');
    contenedorTabla.classList.remove('d-none');

    if (estado.tipo === 'turnos') {
        renderizar(thead, html`
            <tr>
                <th scope="col" style="width: 170px;">Fecha y Hora</th>
                <th scope="col">Paciente</th>
                <th scope="col">Profesional</th>
                <th scope="col" style="width: 140px;">Estado</th>
                <th scope="col">Trabajo de Sesión</th>
                <th scope="col" class="d-print-none text-end" style="width: 120px;">Acciones</th>
            </tr>
        `);

        renderizar(tbody, items.map((t) => {
            const fechaStr = formatearFecha(t.fecha);
            const horaStr = t.hora ? `${String(t.hora).slice(0, 5)} hs` : '—';
            const chipClase = obtenerClaseChipTurno(t.estado?.id);
            const chipIcono = obtenerIconoTurno(t.estado?.id);
            const esRealizado = t.estado?.id === 4;

            const trabajoTexto = t.trabajo_sesion
                ? html`<div class="text-truncate" style="max-width: 260px;" title="${t.trabajo_sesion}">${t.trabajo_sesion}</div>`
                : esRealizado
                    ? html`<span class="text-muted small fst-italic">Sesión registrada</span>`
                    : html`<span class="text-muted small">—</span>`;

            const botonAccion = esRealizado
                ? html`
                    <button type="button" class="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" data-accion="ver-sesion" data-turno-id="${t.id}" title="Consultar notas clínicas de la sesión">
                        <span class="ms ms-sm" aria-hidden="true">visibility</span>
                        <span>${estado.esPro ? 'Ver notas' : 'Ver sesión'}</span>
                    </button>
                `
                : html`<span class="text-muted small">—</span>`;

            return html`
                <tr>
                    <td>
                        <strong>${fechaStr}</strong>
                        <div class="text-muted small">${horaStr}</div>
                    </td>
                    <td>
                        <span class="fw-semibold">${t.paciente?.apellido}, ${t.paciente?.nombre}</span>
                    </td>
                    <td>
                        <span>${t.profesional?.apellido}, ${t.profesional?.nombre}</span>
                    </td>
                    <td>
                        <span class="eg-chip ${chipClase}">
                            ${icono(chipIcono)}${t.estado?.nombre || '—'}
                        </span>
                    </td>
                    <td>${trabajoTexto}</td>
                    <td class="d-print-none text-end">${botonAccion}</td>
                </tr>
            `;
        }));

    } else if (estado.tipo === 'pacientes') {
        renderizar(thead, html`
            <tr>
                <th scope="col">Paciente</th>
                <th scope="col" style="width: 120px;">DNI</th>
                <th scope="col" style="width: 140px;">Edad / F. Nac.</th>
                <th scope="col">Obra Social</th>
                <th scope="col">CUD (Discapacidad)</th>
                <th scope="col" style="width: 130px;">Estado</th>
            </tr>
        `);

        renderizar(tbody, items.map((p) => {
            const edadAnios = p.fecha_nacimiento ? `${edad(p.fecha_nacimiento)} años` : '—';
            const fechaNac = p.fecha_nacimiento ? formatearFecha(p.fecha_nacimiento) : '—';
            const badgeDiscapacidad = p.cud_vencimiento
                ? badgeCud(p.cud_vencimiento)
                : html`<span class="text-muted small">Sin CUD</span>`;
            const esActivo = p.estado?.id === 1;

            return html`
                <tr>
                    <td>
                        <span class="fw-semibold">${p.apellido}, ${p.nombre}</span>
                        ${p.mail ? html`<div class="text-muted small">${p.mail}</div>` : ''}
                    </td>
                    <td><span class="eg-table__num">${p.dni || '—'}</span></td>
                    <td>
                        <div>${edadAnios}</div>
                        <div class="text-muted small">${fechaNac}</div>
                    </td>
                    <td>
                        <div>${p.obra_social?.nombre || 'Particular'}</div>
                        ${p.numero_afiliado ? html`<div class="text-muted small">Af: ${p.numero_afiliado}</div>` : ''}
                    </td>
                    <td>${badgeDiscapacidad}</td>
                    <td>
                        <span class="eg-chip ${esActivo ? 'eg-chip--ok' : 'eg-chip--err'}">
                            ${icono(esActivo ? 'check_circle' : 'cancel')}${p.estado?.nombre || '—'}
                        </span>
                    </td>
                </tr>
            `;
        }));

    } else if (estado.tipo === 'profesionales') {
        renderizar(thead, html`
            <tr>
                <th scope="col">Profesional</th>
                <th scope="col" style="width: 120px;">DNI</th>
                <th scope="col" style="width: 140px;">Matrícula</th>
                <th scope="col">Especialidad</th>
                <th scope="col">Contacto / Mail</th>
                <th scope="col" style="width: 130px;">Estado</th>
            </tr>
        `);

        renderizar(tbody, items.map((prof) => {
            const esActivo = prof.estado_profesional?.id === 1;

            return html`
                <tr>
                    <td>
                        <span class="fw-semibold">${prof.apellido}, ${prof.nombre}</span>
                    </td>
                    <td><span class="eg-table__num">${prof.dni || '—'}</span></td>
                    <td><span>${prof.matricula || '—'}</span></td>
                    <td>
                        <span class="eg-chip eg-chip--primary">
                            ${icono('psychology')}${prof.especialidad?.nombre || 'General'}
                        </span>
                    </td>
                    <td>
                        <div class="small">${enlaceTelefono(prof.contacto)}</div>
                        <div class="small">${enlaceMail(prof.mail)}</div>
                    </td>
                    <td>
                        <span class="eg-chip ${esActivo ? 'eg-chip--ok' : 'eg-chip--err'}">
                            ${icono(esActivo ? 'check_circle' : 'cancel')}${prof.estado_profesional?.nombre || '—'}
                        </span>
                    </td>
                </tr>
            `;
        }));
    }
}

// ============================================================
// Membrete Oficial para Impresión / PDF (CA-04)
// ============================================================
function actualizarMembreteImpresion() {
    const ahora = new Date();
    const fechaHoraEmision = `${ahora.toLocaleDateString('es-AR')} ${ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs`;

    const nombreUsuario = estado.usuario
        ? estado.usuario.profesional
            ? nombreCompleto(estado.usuario.profesional)
            : estado.usuario.usuario
        : 'Usuario del Sistema';
    const rolUsuario = estado.usuario?.rol?.nombre || 'Operador';

    const fechaEl = $('print-fecha');
    if (fechaEl) fechaEl.textContent = fechaHoraEmision;

    const usuarioEl = $('print-usuario');
    if (usuarioEl) usuarioEl.textContent = `${nombreUsuario} (${rolUsuario})`;

    const titulos = {
        turnos: 'Reporte Consolidado de Turnos y Sesiones',
        pacientes: 'Reporte de Padrón General de Pacientes',
        profesionales: 'Reporte Oficial del Equipo Profesional',
    };
    const tituloEl = $('print-reporte-titulo');
    if (tituloEl) tituloEl.textContent = titulos[estado.tipo] || 'Reporte Oficial EduGes';

    let periodoTexto = 'Histórico a la fecha';
    let resumen = `Registros: ${estado.resultados.length}`;

    if (estado.tipo === 'turnos') {
        const desde = $('filtro-turno-desde')?.value ? formatearFecha($('filtro-turno-desde').value) : null;
        const hasta = $('filtro-turno-hasta')?.value ? formatearFecha($('filtro-turno-hasta').value) : null;
        const estadoSel = $('filtro-turno-estado');
        const estadoTexto = estadoSel?.value ? estadoSel.options[estadoSel.selectedIndex].text : 'Todos';

        if (desde && hasta) {
            periodoTexto = `${desde} al ${hasta}`;
        } else if (desde) {
            periodoTexto = `Desde ${desde}`;
        } else if (hasta) {
            periodoTexto = `Hasta ${hasta}`;
        }

        resumen = `Estado: ${estadoTexto}`;
        if (!estado.esPro) {
            const proSel = $('filtro-turno-profesional');
            const proTexto = proSel?.value ? proSel.options[proSel.selectedIndex].text : 'Todos los profesionales';
            resumen += ` | Profesional: ${proTexto}`;
        }
    } else if (estado.tipo === 'pacientes') {
        const estadoSel = $('filtro-paciente-estado');
        const osSel = $('filtro-paciente-obra-social');
        const estadoTexto = estadoSel?.value ? estadoSel.options[estadoSel.selectedIndex].text : 'Todos';
        const osTexto = osSel?.value ? osSel.options[osSel.selectedIndex].text : 'Todas';
        periodoTexto = 'Padrón activo';
        resumen = `Estado: ${estadoTexto} | Obra Social: ${osTexto}`;
    } else if (estado.tipo === 'profesionales') {
        const espSel = $('filtro-profesional-especialidad');
        const estadoSel = $('filtro-profesional-estado');
        const espTexto = espSel?.value ? espSel.options[espSel.selectedIndex].text : 'Todas';
        const estadoTexto = estadoSel?.value ? estadoSel.options[estadoSel.selectedIndex].text : 'Todos';
        periodoTexto = 'Nómina activa';
        resumen = `Especialidad: ${espTexto} | Estado: ${estadoTexto}`;
    }

    const periodoEl = $('print-periodo');
    if (periodoEl) periodoEl.textContent = periodoTexto;

    const criteriosEl = $('print-criterios');
    if (criteriosEl) criteriosEl.textContent = `Filtros: ${resumen} · Total: ${estado.resultados.length} registros`;

    const resumenEl = $('reporte-resumen-filtros');
    if (resumenEl) resumenEl.textContent = `${periodoTexto} | ${resumen}`;
}

// ============================================================
// Exportación a archivo CSV
// ============================================================
function exportarCSV(tipo, resultados) {
    if (!resultados || resultados.length === 0) {
        notificar('No hay datos disponibles para exportar con los filtros actuales.', 'info');
        return;
    }

    const filas = [];
    const nombreArchivo = `EduGes_Reporte_${tipo}_${hoyISO()}.csv`;

    if (tipo === 'turnos') {
        filas.push(['ID', 'Fecha', 'Hora', 'Paciente', 'Profesional', 'Estado', 'Trabajo de Sesión']);
        resultados.forEach((t) => {
            filas.push([
                t.id,
                t.fecha,
                t.hora ? String(t.hora).slice(0, 5) : '',
                `"${t.paciente?.apellido || ''}, ${t.paciente?.nombre || ''}"`,
                `"${t.profesional?.apellido || ''}, ${t.profesional?.nombre || ''}"`,
                `"${t.estado?.nombre || ''}"`,
                `"${(t.trabajo_sesion || '').replace(/"/g, '""')}"`,
            ]);
        });
    } else if (tipo === 'pacientes') {
        filas.push(['ID', 'Apellido', 'Nombre', 'DNI', 'Fecha Nacimiento', 'Obra Social', 'Nro Afiliado', 'CUD Vencimiento', 'Estado']);
        resultados.forEach((p) => {
            filas.push([
                p.id,
                `"${p.apellido || ''}"`,
                `"${p.nombre || ''}"`,
                `"${p.dni || ''}"`,
                p.fecha_nacimiento || '',
                `"${p.obra_social?.nombre || ''}"`,
                `"${p.numero_afiliado || ''}"`,
                p.cud_vencimiento || '',
                `"${p.estado?.nombre || ''}"`,
            ]);
        });
    } else if (tipo === 'profesionales') {
        filas.push(['ID', 'Apellido', 'Nombre', 'DNI', 'Matrícula', 'Especialidad', 'Contacto', 'Mail', 'Estado']);
        resultados.forEach((p) => {
            filas.push([
                p.id,
                `"${p.apellido || ''}"`,
                `"${p.nombre || ''}"`,
                `"${p.dni || ''}"`,
                `"${p.matricula || ''}"`,
                `"${p.especialidad?.nombre || ''}"`,
                `"${p.contacto || ''}"`,
                `"${p.mail || ''}"`,
                `"${p.estado_profesional?.nombre || ''}"`,
            ]);
        });
    }

    // Separador punto y coma (;) y marca de orden de bytes UTF-8 para compatibilidad nativa con Excel
    const contenidoCSV = filas.map((fila) => fila.join(';')).join('\r\n');
    const blob = new Blob(['\uFEFF' + contenidoCSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    notificar('Reporte exportado correctamente a formato CSV.', 'exito');
}

// ============================================================
// Helpers visuales para chips de estados
// ============================================================
function obtenerClaseChipTurno(estadoId) {
    switch (estadoId) {
        case 1: // Pendiente
            return 'eg-chip--info';
        case 2: // Confirmado
            return 'eg-chip--primary';
        case 4: // Realizado
            return 'eg-chip--ok';
        case 5: // Ausente
            return 'eg-chip--warn';
        case 3: // Cancelado
            return 'eg-chip--err';
        default:
            return '';
    }
}

function obtenerIconoTurno(estadoId) {
    switch (estadoId) {
        case 1:
            return 'schedule';
        case 2:
            return 'check';
        case 4:
            return 'task_alt';
        case 5:
            return 'person_off';
        case 3:
            return 'cancel';
        default:
            return 'info';
    }
}
