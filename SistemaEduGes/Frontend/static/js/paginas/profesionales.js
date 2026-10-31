// ============================================================
// EduGes - Módulo Profesionales (templates/profesionales.html)
// Listado con búsqueda, orden y paginación; ficha en panel lateral.
// El SuperAdministrador puede editar los datos de un profesional desde su ficha.
//
// Endpoint: GET /api/profesionales/ → array con TODOS los profesionales:
//   [{ id_profesional, nombre, apellido, dni, matricula, contacto, mail,
//      especialidad, rol, usuario, estado_profesional }]   (los cuatro últimos son IDs)
// Como viene todo junto, la búsqueda, el orden y la paginación se hacen en el navegador.
//
// El estado de la pantalla (búsqueda, orden, página y ficha abierta) se guarda
// en la URL, así se puede recargar o compartir sin perder el lugar.
// ============================================================

import { guardar, prepararModal } from '../componentes/formularios.js';
import { prepararMostrarPassword } from '../componentes/mostrar-password.js';
import {
    enteroDeUrl,
    guardarEnUrl,
    leerUrl,
    mostrarPaginacion,
    paginar,
    prepararPaginacion,
    textoTotal,
} from '../componentes/listado.js';
import { PERMISO } from '../constantes.js';
import { catalogos, profesionales } from '../endpoints.js';
import { esAdministrador, obtenerUsuario, tienePermiso } from '../layout.js';
import { coincideBusqueda, compararTexto, normalizarTexto } from '../texto.js';
import {
    bloqueCargando,
    bloqueVacio,
    capitalizar,
    demorar,
    enlaceMail,
    enlaceTelefono,
    html,
    icono,
    iniciales,
    mostrarError,
    nombreCompleto,
    renderizar,
} from '../ui.js';

const TAMANIO_PAGINA = 10;
const ORDENES = ['apellido', 'nombre', 'matricula'];

const $ = (id) => document.getElementById(id);

const estado = {
    usuario: null,
    todos: [],                  // lo que devolvió la API
    filtros: leerFiltrosDeUrl(),
    fichaId: null,              // profesional con la ficha abierta
    editandoId: null,           // profesional que se está editando (su ficha se reabre al terminar)
};

// ------------------------------------------------------------
// Estado en la URL: /profesionales/?q=gomez&orden=matricula&page=2&ficha=1
// ------------------------------------------------------------
function leerFiltrosDeUrl() {
    const parametros = leerUrl();
    const orden = parametros.get('orden');
    return {
        q: parametros.get('q') ?? '',
        orden: ORDENES.includes(orden) ? orden : 'apellido',
        page: enteroDeUrl(parametros.get('page')) ?? 1,
    };
}

function guardarEstadoEnUrl() {
    const f = estado.filtros;
    guardarEnUrl({
        q: f.q,
        orden: f.orden !== 'apellido' ? f.orden : null,
        page: f.page > 1 ? f.page : null,
        ficha: estado.fichaId,
    });
}

// ------------------------------------------------------------
// Búsqueda y orden (en el navegador)
// ------------------------------------------------------------
// "maria gom" encuentra a "María Gómez"; "gomez" encuentra a "Gómez"
const coincide = (p, q) => coincideBusqueda([p.nombre, p.apellido, p.dni, p.matricula], q);

const CRITERIOS = {
    apellido: (a, b) => compararTexto(a.apellido, b.apellido) || compararTexto(a.nombre, b.nombre),
    nombre: (a, b) => compararTexto(a.nombre, b.nombre) || compararTexto(a.apellido, b.apellido),
    matricula: (a, b) => compararTexto(a.matricula, b.matricula),
};

function filtrados() {
    const { q, orden } = estado.filtros;
    const lista = q.trim() ? estado.todos.filter((p) => coincide(p, q)) : [...estado.todos];
    return lista.sort(CRITERIOS[orden]);
}

// ------------------------------------------------------------
// Presentación
// ------------------------------------------------------------
const esUsuarioActual = (p) => estado.usuario.profesional?.id === p.id_profesional;

// La API solo deja editar al SuperAdministrador (el único con usuarios.admin)
const puedeEditar = () => esAdministrador(estado.usuario);

// "30123456" → "30.123.456" (más fácil de leer)
const formatearDni = (dni) => String(dni ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function contacto(p) {
    if (!p.contacto && !p.mail) {
        return html`<span class="eg-empty-text">Sin datos de contacto</span>`;
    }
    return html`
        <div class="eg-contact">
            ${p.contacto && html`<a href="tel:${p.contacto.replace(/[^\d+]/g, '')}">${icono('call')}${p.contacto}</a>`}
            ${p.mail && html`<a href="mailto:${p.mail}">${icono('mail')}${p.mail}</a>`}
        </div>`;
}

function filaProfesional(p) {
    const yo = esUsuarioActual(p);
    const especialidad = yo ? estado.usuario.profesional.especialidad?.nombre : null;
    return html`
        <div class="eg-table__row${yo ? ' is-me' : ''}" role="row" data-profesional-id="${p.id_profesional}">
            <div class="eg-table__main" role="cell">
                <div>
                    <div class="eg-table__name">
                        ${nombreCompleto(p, { apellidoPrimero: true })}
                        ${yo && html`<span class="eg-badge-me">Vos</span>`}
                    </div>
                    <div class="eg-table__meta">${especialidad ? `${especialidad} · ` : ''}Mat. ${p.matricula}</div>
                </div>
            </div>
            <span class="eg-table__num" role="cell"><span class="visually-hidden">DNI </span>${formatearDni(p.dni)}</span>
            <div role="cell">${contacto(p)}</div>
            <div class="eg-table__action" role="cell">
                <button type="button" class="eg-btn" data-accion="ver-ficha" aria-label="Ver ficha de ${nombreCompleto(p)}">
                    ${icono('contact_page')}Ver ficha
                </button>
            </div>
        </div>`;
}

function mostrarListado() {
    const lista = filtrados();
    const resultado = paginar(lista, estado.filtros.page, TAMANIO_PAGINA);
    estado.filtros.page = resultado.pagina;

    const mensajeVacio = estado.filtros.q.trim()
        ? 'No hay profesionales que coincidan con la búsqueda.'
        : 'Todavía no hay profesionales cargados.';
    renderizar($('profesionales-cuerpo'), resultado.items.map(filaProfesional));
    renderizar($('profesionales-estado'), resultado.items.length > 0 ? '' : bloqueVacio(mensajeVacio, 'person_search'));

    $('profesionales-total').textContent = textoTotal(lista.length, estado.todos.length, ['profesional', 'profesionales']);
    mostrarPaginacion($('profesionales-paginacion'), resultado);
    guardarEstadoEnUrl();
}

async function cargarListado() {
    renderizar($('profesionales-cuerpo'), '');
    renderizar($('profesionales-estado'), bloqueCargando(3));
    try {
        estado.todos = await profesionales.listar();
        mostrarListado();
        return true;
    } catch (error) {
        $('profesionales-total').textContent = '';
        $('profesionales-paginacion').classList.add('d-none');
        mostrarError($('profesionales-estado'), error, () => cargarListado());
        return false;
    }
}

// ------------------------------------------------------------
// Ficha (con los datos del listado: la API no tiene detalle aparte)
// ------------------------------------------------------------
const panelFicha = () => window.bootstrap.Modal.getOrCreateInstance($('ficha-profesional'));

function abrirFicha(id) {
    const p = estado.todos.find((prof) => prof.id_profesional === id);
    estado.fichaId = p ? id : null;
    guardarEstadoEnUrl();

    if (!p) {
        $('ficha-titulo').textContent = 'Ficha del profesional';
        $('ficha-subtitulo').textContent = '';
        renderizar($('ficha-cuerpo'), bloqueVacio('No se encontró este profesional.', 'person_search'));
        panelFicha().show();
        return;
    }

    // La especialidad solo viene con nombre en /me: se conoce únicamente la del usuario actual
    const especialidad = esUsuarioActual(p) ? estado.usuario.profesional.especialidad?.nombre : null;
    $('ficha-titulo').textContent = nombreCompleto(p);
    $('ficha-subtitulo').textContent = especialidad ?? `Matrícula ${p.matricula}`;

    renderizar($('ficha-cuerpo'), html`
        <div class="eg-ficha eg-ficha--una">
            <div class="eg-ficha__datos">
                ${(esUsuarioActual(p) || puedeEditar()) && html`
                    <div class="eg-ficha__chips">
                        ${esUsuarioActual(p) && html`<span class="eg-chip eg-chip--info">${icono('person_check')}Este es tu perfil</span>`}
                        ${puedeEditar() && html`
                            <button type="button" class="eg-btn ms-auto" data-accion="editar">
                                ${icono('edit')}Editar datos
                            </button>`}
                    </div>`}
                <section class="eg-ficha__bloque" aria-labelledby="ficha-datos-titulo">
                    <h3 id="ficha-datos-titulo">${icono('badge')}Datos profesionales</h3>
                    <dl class="ficha-dato row g-0">
                        <div class="col-6"><dt>Matrícula</dt><dd>${p.matricula}</dd></div>
                        <div class="col-6"><dt>DNI</dt><dd>${p.dni}</dd></div>
                    </dl>
                </section>
                <section class="eg-ficha__bloque" aria-labelledby="ficha-contacto-titulo">
                    <h3 id="ficha-contacto-titulo">${icono('contact_phone')}Contacto</h3>
                    <dl class="ficha-dato row g-0">
                        <div class="col-12 col-sm-6"><dt>Teléfono</dt><dd>${enlaceTelefono(p.contacto)}</dd></div>
                        <div class="col-12 col-sm-6"><dt>Mail</dt><dd>${enlaceMail(p.mail)}</dd></div>
                    </dl>
                </section>
            </div>
        </div>`);
    panelFicha().show();
}

// ------------------------------------------------------------
// Editar datos (modal)
// La ficha (panel lateral) se cierra antes de abrir el modal y se vuelve a abrir al
// terminar: con los dos abiertos a la vez, el foco del teclado queda atrapado mal.
// ------------------------------------------------------------
const CAMPOS_EDITABLES = ['nombre', 'apellido', 'dni', 'matricula', 'contacto', 'mail'];
let modalEdicion = null;

function validarEdicion(datos, formulario) {
    const errores = {};
    if (!datos.nombre) {
        errores.nombre = ['Indicá el nombre.'];
    }
    if (!datos.apellido) {
        errores.apellido = ['Indicá el apellido.'];
    }
    if (!datos.dni) {
        errores.dni = ['Indicá el DNI.'];
    } else if (!/^\d{7,8}$/.test(datos.dni)) {
        errores.dni = ['El DNI tiene que tener 7 u 8 números, sin puntos.'];
    }
    if (!datos.matricula) {
        errores.matricula = ['Indicá la matrícula.'];
    }
    if (datos.mail && !formulario.elements.mail.checkValidity()) {
        errores.mail = ['Revisá el mail: falta la @ o el dominio.'];
    }
    return errores;
}

function prepararEdicion() {
    const formulario = $('form-profesional');
    modalEdicion = prepararModal({
        modal: $('modal-profesional'),
        formulario,
        contenedorErrores: $('form-profesional-errores'),
        alAbrir: () => {
            const p = estado.todos.find((prof) => prof.id_profesional === estado.editandoId);
            $('modal-profesional-nombre').textContent = nombreCompleto(p);
            CAMPOS_EDITABLES.forEach((campo) => {
                formulario.elements[campo].value = p[campo] ?? '';
            });
        },
    });

    // Al cerrar (guardando o no) se vuelve a la ficha, ya con los datos actualizados
    $('modal-profesional').addEventListener('hidden.bs.modal', () => {
        const id = estado.editandoId;
        estado.editandoId = null;
        if (id !== null) {
            abrirFicha(id);
        }
    });

    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        const actual = estado.todos.find((prof) => prof.id_profesional === estado.editandoId);
        const datos = Object.fromEntries(CAMPOS_EDITABLES.map((campo) => [campo, formulario.elements[campo].value.trim()]));
        // Solo se envía lo que cambió (vacío = sin dato, para teléfono y mail)
        const cambios = Object.fromEntries(Object.entries(datos)
            .map(([campo, valor]) => [campo, valor === '' && ['contacto', 'mail'].includes(campo) ? null : valor])
            .filter(([campo, valor]) => valor !== (actual[campo] ?? null)));
        const sinCambios = Object.keys(cambios).length === 0;

        guardar({
            formulario,
            contenedorErrores: $('form-profesional-errores'),
            boton: $('btn-guardar-profesional'),
            errores: validarEdicion(datos, formulario),
            enviar: () => (sinCambios ? Promise.resolve(actual) : profesionales.actualizar(actual.id_profesional, cambios)),
            mensajeExito: sinCambios ? 'No había cambios para guardar.' : 'Los datos del profesional se actualizaron.',
            modal: modalEdicion,
            alGuardar: (actualizado) => {
                estado.todos = estado.todos.map((prof) => (prof.id_profesional === actualizado.id_profesional ? actualizado : prof));
                mostrarListado();
            },
        });
    });
}

function abrirEdicion() {
    estado.editandoId = estado.fichaId;
    $('ficha-profesional').addEventListener('hidden.bs.modal', () => modalEdicion().show(), { once: true });
    panelFicha().hide();
}

// ------------------------------------------------------------
// Alta de nuevo profesional y cuenta de usuario (modal)
// ------------------------------------------------------------
let modalAlta = null;

function sugerirNombreUsuario(nombre, apellido) {
    const n = normalizarTexto(nombre).replace(/[^a-z0-9]/g, '');
    const a = normalizarTexto(apellido).replace(/[^a-z0-9]/g, '');
    if (n && a) return `${n}.${a}`;
    return n || a || '';
}

function validarAlta(datos, formulario) {
    const errores = {};
    const obligatorio = (campo, valor, msg) => {
        if (!valor) errores[campo] = [msg];
    };

    obligatorio('nombre', datos.nombre, 'Indicá el nombre.');
    obligatorio('apellido', datos.apellido, 'Indicá el apellido.');
    if (!datos.dni) {
        errores.dni = ['Indicá el DNI.'];
    } else if (!/^\d{7,8}$/.test(datos.dni)) {
        errores.dni = ['El DNI tiene que tener 7 u 8 números, sin puntos.'];
    }
    obligatorio('matricula', datos.matricula, 'Indicá la matrícula profesional.');
    obligatorio('especialidad', datos.especialidad, 'Seleccioná la especialidad.');

    if (datos.mail && !formulario.elements.mail.checkValidity()) {
        errores.mail = ['Revisá el mail: falta la @ o el dominio.'];
    }

    if (!datos.usuario) {
        errores.usuario = ['Indicá un nombre de usuario para el ingreso.'];
    } else if (/\s/.test(datos.usuario)) {
        errores.usuario = ['El usuario no puede contener espacios.'];
    }

    if (!datos.password) {
        errores.password = ['Indicá una contraseña inicial.'];
    } else if (datos.password.length < 8) {
        errores.password = ['La contraseña tiene que tener al menos 8 caracteres.'];
    }

    if (!datos.password_confirm) {
        errores.password_confirm = ['Confirmá la contraseña.'];
    } else if (datos.password && datos.password !== datos.password_confirm) {
        errores.password_confirm = ['Las contraseñas no coinciden.'];
    }

    return errores;
}

function prepararAlta() {
    const btnNuevo = $('btn-nuevo-profesional');
    const formNuevo = $('form-nuevo-profesional');
    if (!btnNuevo || !formNuevo) return;

    const selectEspecialidad = $('nuevo-prof-especialidad');
    const inputNombre = $('nuevo-prof-nombre');
    const inputApellido = $('nuevo-prof-apellido');
    const inputUsuario = $('nuevo-prof-usuario');

    prepararMostrarPassword(formNuevo);

    modalAlta = prepararModal({
        modal: $('modal-nuevo-profesional'),
        formulario: formNuevo,
        contenedorErrores: $('form-nuevo-profesional-errores'),
        alAbrir: async () => {
            try {
                const lista = await catalogos.especialidades();
                if (selectEspecialidad && lista.length) {
                    selectEspecialidad.innerHTML = '<option value="">Seleccioná especialidad</option>';
                    lista.forEach((esp) => {
                        const opt = document.createElement('option');
                        opt.value = esp.id;
                        opt.textContent = esp.nombre;
                        selectEspecialidad.appendChild(opt);
                    });
                    selectEspecialidad.value = String(lista[0].id);
                }
            } catch {
                // Mantiene opción por defecto
            }
        },
    });

    btnNuevo.addEventListener('click', () => modalAlta().show());

    // Capitalizar nombre y apellido al salir del campo
    [inputNombre, inputApellido].forEach((input) => {
        if (input) {
            input.addEventListener('blur', () => {
                if (input.value.trim()) {
                    input.value = capitalizar(input.value);
                }
            });
        }
    });

    // Sugerir usuario automáticamente al escribir nombre o apellido
    let usuarioEditadoManualmente = false;
    inputUsuario?.addEventListener('input', () => {
        usuarioEditadoManualmente = Boolean(inputUsuario.value.trim());
    });

    const actualizarSugerenciaUsuario = () => {
        if (!usuarioEditadoManualmente) {
            const sug = sugerirNombreUsuario(inputNombre.value, inputApellido.value);
            if (inputUsuario) inputUsuario.value = sug;
        }
    };
    inputNombre?.addEventListener('input', actualizarSugerenciaUsuario);
    inputApellido?.addEventListener('input', actualizarSugerenciaUsuario);

    formNuevo.addEventListener('submit', (evento) => {
        evento.preventDefault();
        const campo = (nom) => formNuevo.elements[nom]?.value?.trim() ?? '';
        const datos = {
            nombre: capitalizar(campo('nombre')),
            apellido: capitalizar(campo('apellido')),
            dni: campo('dni'),
            matricula: campo('matricula'),
            especialidad: Number(campo('especialidad')) || 1,
            contacto: campo('contacto') || null,
            mail: campo('mail') || null,
            usuario: campo('usuario').toLowerCase(),
            password: formNuevo.elements.password?.value ?? '',
            password_confirm: formNuevo.elements.password_confirm?.value ?? '',
            rol: 2, // Rol Profesional
            estado_profesional: 1, // Estado Activo
        };

        guardar({
            formulario: formNuevo,
            contenedorErrores: $('form-nuevo-profesional-errores'),
            boton: $('btn-guardar-nuevo-profesional'),
            errores: validarAlta(datos, formNuevo),
            enviar: async () => {
                const { password_confirm, ...payload } = datos;
                return await profesionales.crear(payload);
            },
            mensajeExito: 'Profesional y cuenta de usuario creados exitosamente.',
            modal: modalAlta,
            alGuardar: async () => {
                usuarioEditadoManualmente = false;
                await cargarListado();
            },
        });
    });
}

// ------------------------------------------------------------
// Eventos
// ------------------------------------------------------------
function cambiarFiltros(cambios) {
    Object.assign(estado.filtros, cambios, { page: 1 });
    mostrarListado();
}

function prepararEventos() {
    const formulario = $('filtros-profesionales');
    const busqueda = $('filtro-q');
    const orden = $('filtro-orden');
    busqueda.value = estado.filtros.q;
    orden.value = estado.filtros.orden;

    const buscar = demorar(() => cambiarFiltros({ q: busqueda.value }), 200);
    busqueda.addEventListener('input', buscar);
    orden.addEventListener('change', () => cambiarFiltros({ orden: orden.value }));
    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        cambiarFiltros({ q: busqueda.value });
    });
    formulario.addEventListener('reset', () => {
        // El reset del navegador vacía los campos después de este evento
        setTimeout(() => cambiarFiltros({ q: '', orden: 'apellido' }));
    });

    prepararPaginacion($('profesionales-paginacion'), (cambio) => {
        estado.filtros.page += cambio;
        mostrarListado();
    });

    $('profesionales-cuerpo').addEventListener('click', (evento) => {
        // Los links de teléfono y mail funcionan normal; el resto de la fila abre la ficha
        if (evento.target.closest('a')) {
            return;
        }
        const fila = evento.target.closest('[data-profesional-id]');
        if (fila) {
            abrirFicha(Number(fila.dataset.profesionalId));
        }
    });

    $('ficha-cuerpo').addEventListener('click', (evento) => {
        if (evento.target.closest('[data-accion="editar"]')) {
            abrirEdicion();
        }
    });

    $('ficha-profesional').addEventListener('hidden.bs.modal', (evento) => {
        if (evento.target !== $('ficha-profesional')) {
            return;
        }
        const id = estado.fichaId;
        estado.fichaId = null;
        guardarEstadoEnUrl();
        // La ficha se abre por código: Bootstrap no devuelve el foco solo.
        // Si se cerró para editar, el foco lo toma el modal.
        if (estado.editandoId === null) {
            document.querySelector(`[data-profesional-id="${id}"] [data-accion="ver-ficha"]`)?.focus();
        }
    });
}

// ------------------------------------------------------------
// Inicio
// ------------------------------------------------------------
async function iniciar() {
    // Se lee antes de cargar el listado, que reescribe la URL
    const fichaInicial = enteroDeUrl(new URLSearchParams(window.location.search).get('ficha'));
    prepararEventos();

    try {
        estado.usuario = await obtenerUsuario();
    } catch (error) {
        // 401: api.js ya redirige al login
        if (error.status !== 401) {
            mostrarError($('profesionales-estado'), error, () => window.location.reload());
        }
        return;
    }

    if (!tienePermiso(estado.usuario, PERMISO.PROFESIONALES_VER)) {
        renderizar($('profesionales-estado'), bloqueVacio('No tenés acceso al listado de profesionales.', 'lock'));
        return;
    }

    if (puedeEditar()) {
        prepararEdicion();
        prepararAlta();
    }
    if (await cargarListado() && fichaInicial) {
        abrirFicha(fichaInicial);
    }
}

iniciar();
