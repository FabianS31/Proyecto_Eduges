// ============================================================
// EduGes - Formulario "Nuevo paciente" (templates/componentes/modal_paciente.html)
// Lo usan el dashboard y la página de Pacientes.
//
//   const abrirNuevoPaciente = prepararFormularioPaciente({
//       alGuardar: (pacienteCreado) => { ... },
//   });
//   boton.addEventListener('click', abrirNuevoPaciente);
//
// Endpoint: POST /api/pacientes/ (paciente, asignacion y tutor en una transaccion).
// Conforme a ERS v1.2 (CU01 / RN-08), el alta requiere al menos un tutor
// marcado como Responsable Principal.
// ============================================================

import { cargarParentescos } from './catalogo-parentescos.js';
import { ApiError } from '../api.js';
import { catalogos, pacientes, profesionales, tutores } from '../endpoints.js';
import { obtenerUsuario } from '../layout.js';
import { hoyISO } from '../fechas.js';
import { buscarEnLista, crearCombobox } from './combobox.js';
import { validarCud, validarCamposPreventivos, validarNombrePersonal, errorDomicilio, guardar, prepararModal, mostrarErroresDelFormulario } from './formularios.js';
import { capitalizar, notificar } from '../ui.js';
import { coincideBusqueda } from '../texto.js';

const $ = (id) => document.getElementById(id);

const soloDigitos = (texto) => /^\d+$/.test(texto);

async function sugerirObrasSociales(texto) {
    try {
        const lista = await catalogos.obrasSociales();
        const opciones = (Array.isArray(lista) ? lista : []).map((item) => ({ valor: item.id, texto: item.nombre }));
        return buscarEnLista(opciones)(texto);
    } catch {
        return [];
    }
}

let tutoresDisponibles = null;

async function sugerirTutores(texto) {
    if (tutoresDisponibles === null) {
        tutoresDisponibles = await tutores.listar();
    }
    const t = texto.trim();
    if (!t) return [];

    return tutoresDisponibles
        .filter((item) => {
            const nom = item.nombre || '';
            const ape = item.apellido || '';
            const dni = String(item.dni || '');
            return coincideBusqueda([nom, ape, dni], t);
        })
        .map((item) => {
            const pacientesRel = (item.relaciones || [])
                .map((r) => r.paciente)
                .filter(Boolean)
                .map((p) => `${p.apellido}, ${p.nombre}`)
                .join(', ');

            const detallePartes = [];
            if (item.dni) detallePartes.push(`DNI ${item.dni}`);
            if (pacientesRel) detallePartes.push(`Tutor de: ${pacientesRel}`);

            return {
                valor: item.id,
                texto: `${item.nombre} ${item.apellido}`.trim(),
                detalle: detallePartes.join(' · '),
                tutor: item,
            };
        });
}

let esAdministrativo = false;

async function inicializarRolYProfesionales() {
    try {
        const u = await obtenerUsuario();
        const rol = u?.rol?.nombre ?? u?.rol ?? '';
        esAdministrativo = (rol === 'Administrador' || rol === 'SuperAdministrador');
        const grupoProf = $('grupo-pac-profesional');
        const selectProf = $('pac-profesional');
        const avisoAsig = $('pac-aviso-asignacion');

        if (esAdministrativo) {
            if (grupoProf) grupoProf.style.display = 'block';
            if (avisoAsig) avisoAsig.textContent = '* Campos obligatorios.';
            if (selectProf && selectProf.dataset.cargado !== 'true') {
                try {
                    const lista = await profesionales.listar();
                    selectProf.innerHTML = '<option value="">Seleccioná un profesional</option>';
                    lista.forEach((p) => {
                        const opt = document.createElement('option');
                        opt.value = p.id_profesional ?? p.id;
                        const esp = p.especialidad?.nombre ? ` (${p.especialidad.nombre})` : '';
                        opt.textContent = `${p.apellido}, ${p.nombre}${esp}`;
                        selectProf.appendChild(opt);
                    });
                    selectProf.dataset.cargado = 'true';
                } catch {
                    // Mantiene la opción inicial si falla la consulta
                }
            }
        } else {
            if (grupoProf) grupoProf.style.display = 'none';
            if (avisoAsig) avisoAsig.textContent = '* Campos obligatorios. El paciente queda asignado a vos.';
        }
    } catch {
        esAdministrativo = false;
    }
}

function cargarOpcionesParentescos(select) {
    return cargarParentescos(select, $('tutor-parentesco-aviso'), $('tutor-parentesco-reintentar'));
}

function validar(datos, formulario, reutilizarTutor = false) {
    const errores = {};
    const obligatorio = (nombre, valor, mensaje) => {
        if (!valor) {
            errores[nombre] = [mensaje];
        }
    };
    obligatorio('nombre', datos.nombre, 'Indicá el nombre.');
    obligatorio('apellido', datos.apellido, 'Indicá el apellido.');
    if (!datos.dni) {
        errores.dni = ['Indicá el DNI.'];
    } else if (!soloDigitos(datos.dni) || datos.dni.length < 7 || datos.dni.length > 8) {
        errores.dni = ['El DNI tiene que tener 7 u 8 números, sin puntos.'];
    }
    if (!datos.obra_social) {
        errores.obra_social = [$('pac-obra-social').value.trim()
            ? 'Elegí la obra social de la lista de sugerencias.'
            : 'Indicá la obra social.'];
    }
    Object.assign(errores, validarCamposPreventivos(datos, {
        fecha_nacimiento: { requerido: true, tipo: 'nacimiento', mensajeRequerido: 'Indicá la fecha de nacimiento.' },
        mail: { max: 50, tipo: 'email' },
        direccion: { requerido: true, max: 255, mensajeRequerido: 'Indicá la dirección.' },
        numero_afiliado: { requerido: true, max: 20, mensajeRequerido: 'Indicá el número de afiliado.' },
        cud_numero: { max: 20 },
        cud_vencimiento: { tipo: 'fecha' },
    }), validarCud(datos));
    if (formulario.elements.cud_vencimiento.validity?.badInput) {
        errores.cud_vencimiento = ['Ingresá una fecha válida.'];
    }
    if (!datos.consentimiento) {
        errores.consentimiento = ['Sin el consentimiento firmado no se puede registrar al paciente.'];
    }

    // Tutor responsable principal (CU01 / RN-08)
    obligatorio('tutor_nombre', datos.tutor.nombre, 'Indicá el nombre del tutor.');
    obligatorio('tutor_apellido', datos.tutor.apellido, 'Indicá el apellido del tutor.');
    if (!datos.tutor.dni) {
        errores.tutor_dni = ['Indicá el DNI del tutor.'];
    } else if (!soloDigitos(datos.tutor.dni) || datos.tutor.dni.length < 7 || datos.tutor.dni.length > 8) {
        errores.tutor_dni = ['El DNI del tutor tiene que tener 7 u 8 números, sin puntos.'];
    }
    obligatorio('tutor_parentesco_id', !$('tutor-parentesco').disabled && datos.tutor.parentesco_id, 'Seleccioná el parentesco.');
    const erroresTutor = validarCamposPreventivos(datos.tutor, {
        telefono: { requerido: true, max: 30, mensajeRequerido: 'Indicá un teléfono de contacto.' },
        movil: { max: 30 },
        mail: { requerido: true, max: 150, tipo: 'email', mensajeRequerido: 'Indicá el mail del tutor.' },
        domicilio: { requerido: true, mensajeRequerido: 'Indicá el domicilio del tutor.' },
    });
    for (const [clave, mensajes] of Object.entries(erroresTutor)) {
        errores['tutor_' + clave] = mensajes;
    }
    if (errorDomicilio(datos.direccion)) errores.direccion = [errorDomicilio(datos.direccion)];
    if (errorDomicilio(datos.tutor.domicilio)) errores.tutor_domicilio = [errorDomicilio(datos.tutor.domicilio)];

    if ([...datos.tutor.domicilio].length > 225) {
        errores.tutor_domicilio = ['El domicilio del tutor supera los 225 caracteres. Si se copió la dirección del paciente, ingresá un domicilio de hasta 225 caracteres para el tutor; la dirección del paciente se conservará completa.'];
    }

    if (esAdministrativo) {
        obligatorio('profesional', datos.profesional, 'Seleccioná el profesional responsable.');
    }

    for (const campo of ['nombre', 'apellido']) {
        const error = validarNombrePersonal(datos[campo], campo);
        if (error) errores[campo] = [error];
    }
    for (const campo of ['nombre', 'apellido']) {
        const error = validarNombrePersonal(datos.tutor[campo], campo);
        if (error) errores['tutor_' + campo] = [error];
    }
    if (reutilizarTutor) {
        for (const campo of ['nombre', 'apellido', 'telefono', 'movil', 'mail', 'domicilio']) {
            delete errores['tutor_' + campo];
        }
    }
    return errores;
}

export function prepararFormularioPaciente({ alGuardar } = {}) {
    const formulario = $('form-paciente');
    const contenedorErrores = $('form-paciente-errores');
    const selectParentesco = $('tutor-parentesco');
    let altaInciertaDni = null;
    const botonComprobar = $('btn-comprobar-alta-paciente');

    const obraSocial = crearCombobox($('pac-obra-social'), {
        buscar: sugerirObrasSociales,
        mensajeVacio: 'No hay obras sociales cargadas.',
    });

    const comboboxTutor = crearCombobox($('tutor-nombre'), {
        buscar: sugerirTutores,
        textoLibre: true,
        minimo: 1,
        mensajeVacio: 'No se encontraron tutores con ese nombre o DNI.',
        alElegir: (opcion) => {
            if (opcion && opcion.tutor) {
                const t = opcion.tutor;
                $('tutor-nombre').value = t.nombre || '';
                $('tutor-apellido').value = t.apellido || '';
                $('tutor-dni').value = t.dni || '';
                for (const campo of ['telefono', 'movil', 'mail', 'domicilio']) {
                    $('tutor-' + campo).value = t[campo] || '';
                }
                $('form-paciente')?.dispatchEvent?.(new CustomEvent('eduges:sincronizar-campos'));

                const primerParentesco = (t.relaciones || [])[0]?.parentesco?.id;
                if (primerParentesco && !selectParentesco.value) {
                    selectParentesco.value = primerParentesco;
                }
                selectParentesco.focus();
            }
        },
    });

    const modal = prepararModal({
        modal: $('modal-paciente'),
        formulario,
        contenedorErrores,
        comboboxes: [obraSocial, comboboxTutor],
        alAbrir: () => {
            tutoresDisponibles = null;
            $('pac-nacimiento').max = hoyISO();
            actualizarComprobacion();
            cargarOpcionesParentescos(selectParentesco);
            inicializarRolYProfesionales();
        },
    });

    let enviando = false;

    function actualizarComprobacion() {
        botonComprobar.hidden = !altaInciertaDni;
        $('btn-guardar-paciente').disabled = enviando || Boolean(altaInciertaDni);
        if (altaInciertaDni) {
            mostrarErroresDelFormulario(formulario, contenedorErrores, new ApiError(0, {
                detail: `No se pudo confirmar el alta del DNI ${altaInciertaDni}. Usá Comprobar alta antes de reintentar. No se enviará otra creación automáticamente.`,
            }));
        }
    }

    // No cerrar durante una petición: evita que su respuesta afecte otro formulario.
    $('modal-paciente').addEventListener('hide.bs.modal', (evento) => {
        if (enviando) evento.preventDefault();
    });

    botonComprobar.addEventListener('click', async () => {
        if (enviando || !altaInciertaDni) return;
        enviando = true;
        botonComprobar.disabled = true;
        try {
            const resultado = await pacientes.comprobarAlta(altaInciertaDni);
            if (!resultado || !Object.prototype.hasOwnProperty.call(resultado, 'paciente')) {
                throw new ApiError(0);
            }
            altaInciertaDni = null;
            if (resultado.paciente) {
                enviando = false;
                modal().hide();
                notificar('Se encontró un alta completa con ese DNI. Revisá los datos en la ficha del paciente.');
                alGuardar?.(resultado.paciente);
            } else {
                mostrarErroresDelFormulario(formulario, contenedorErrores, new ApiError(400, {
                    detail: 'No se encontró un alta completa que puedas consultar. La petición anterior podría seguir en curso. Podés comprobar los datos y reintentar manualmente; el DNI único evita duplicar al paciente.',
                }));
            }
        } catch (error) {
            mostrarErroresDelFormulario(formulario, contenedorErrores, error);
        } finally {
            enviando = false;
            botonComprobar.disabled = false;
            actualizarComprobacion();
        }
    });

    ['pac-nombre', 'pac-apellido', 'tutor-nombre', 'tutor-apellido'].forEach((id) => {
        const input = $(id);
        if (input) {
            input.addEventListener('blur', () => {
                if (input.value.trim()) {
                    input.value = capitalizar(input.value);
                }
            });
        }
    });

    formulario.addEventListener('submit', async (evento) => {
        evento.preventDefault();
        if (enviando || altaInciertaDni) {
            return;
        }
        enviando = true;
        const campo = (nombre) => formulario.elements[nombre]?.value?.trim() ?? '';
        const datos = {
            nombre: capitalizar(campo('nombre')),
            apellido: capitalizar(campo('apellido')),
            dni: formulario.elements.dni.value,
            fecha_nacimiento: campo('fecha_nacimiento'),
            mail: campo('mail') || null,
            direccion: campo('direccion'),
            obra_social: obraSocial.valor(),
            numero_afiliado: campo('numero_afiliado'),
            cud_numero: campo('cud_numero') || null,
            cud_vencimiento: campo('cud_vencimiento') || null,
            consentimiento: formulario.elements.consentimiento.checked,
            profesional: Number(campo('profesional')) || null,
            tutor: {
                nombre: capitalizar(campo('tutor_nombre')),
                apellido: capitalizar(campo('tutor_apellido')),
                dni: formulario.elements.tutor_dni.value,
                parentesco_id: Number(campo('tutor_parentesco_id')) || null,
                telefono: campo('tutor_telefono'),
                movil: campo('tutor_movil') || null,
                mail: campo('tutor_mail'),
                domicilio: campo('tutor_domicilio') || campo('direccion'),
                responsable_principal: true,
            },
        };

        const reutilizarTutor = tutoresDisponibles?.some(t => String(t.dni) === datos.tutor.dni) === true;
        const errores = validar(datos, formulario, reutilizarTutor);
        if (reutilizarTutor) {
            const tutor = tutoresDisponibles.find(t => String(t.dni) === datos.tutor.dni);
            if (!String(tutor.telefono || '').trim()) {
                errores.tutor_telefono = ['El tutor seleccionado no tiene teléfono. Completalo mediante una edición autorizada antes de designarlo principal.'];
            }
            const { dni, parentesco_id, responsable_principal } = datos.tutor;
            datos.tutor = { dni, parentesco_id, responsable_principal };
        }
        try {
            await guardar({
                formulario,
                contenedorErrores,
                boton: $('btn-guardar-paciente'),
                errores,
                enviar: async () => {
                    const { profesional, ...alta } = datos;
                    try {
                        const resultado = await pacientes.crear({
                            ...alta,
                            ...(esAdministrativo && profesional ? { profesional } : {}),
                        });
                        if (!resultado?.id_paciente) throw new ApiError(0);
                        // Permitir el cierre que realiza guardar() después de confirmar el alta.
                        enviando = false;
                        return resultado;
                    } catch (error) {
                        if (!error.status || error.status >= 500 || error.status === 408) {
                            altaInciertaDni = datos.dni;
                            throw new ApiError(0, { detail: 'No se pudo confirmar el resultado. Comprobá el alta antes de reintentar.' });
                        }
                        const campos = {};
                        for (const [clave, valor] of Object.entries(error.erroresDeCampo || {})) {
                            campos[clave.startsWith('tutor.') ? clave.replace('tutor.', 'tutor_') : clave] = valor;
                        }
                        throw new ApiError(error.status, { ...campos, detail: error.message });
                    }
                },
                mensajeExito: 'El paciente y su tutor responsable quedaron registrados exitosamente.',
                modal,
                alGuardar,
            });
        } finally {
            enviando = false;
            actualizarComprobacion();
        }
    });

    return () => modal().show();
}
