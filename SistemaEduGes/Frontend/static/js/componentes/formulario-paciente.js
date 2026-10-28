// ============================================================
// EduGes - Formulario "Nuevo paciente" (templates/componentes/modal_paciente.html)
// Lo usan el dashboard y la página de Pacientes.
//
//   const abrirNuevoPaciente = prepararFormularioPaciente({
//       alGuardar: (pacienteCreado) => { ... },
//   });
//   boton.addEventListener('click', abrirNuevoPaciente);
//
// Endpoint: POST /api/pacientes/ (pacientes.crear) y POST /api/tutores/ (tutores.crear).
// Conforme a ERS v1.2 (CU01 / RN-08), el alta requiere al menos un tutor
// marcado como Responsable Principal.
// ============================================================

import { ApiError } from '../api.js';
import { catalogos, pacientes, tutores } from '../endpoints.js';
import { hoyISO } from '../fechas.js';
import { buscarEnLista, crearCombobox } from './combobox.js';
import { guardar, prepararModal } from './formularios.js';

const $ = (id) => document.getElementById(id);

const soloDigitos = (texto) => /^\d+$/.test(texto);

async function sugerirObrasSociales(texto) {
    const opciones = (await catalogos.obrasSociales()).map((item) => ({ valor: item.id, texto: item.nombre }));
    return buscarEnLista(opciones)(texto);
}

async function cargarOpcionesParentescos(select) {
    if (!select || select.dataset.cargado === 'true') {
        return;
    }
    try {
        const lista = await catalogos.parentescos();
        select.innerHTML = '<option value="">Seleccioná un parentesco</option>';
        lista.forEach((item) => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.nombre;
            select.appendChild(opt);
        });
        select.dataset.cargado = 'true';
    } catch {
        select.innerHTML = `
            <option value="">Seleccioná un parentesco</option>
            <option value="1">Padre</option>
            <option value="5">Madre</option>
            <option value="2">Tutor Legal</option>
            <option value="3">Abuelo/a</option>
            <option value="4">Tío/a</option>
        `;
    }
}

function validar(datos, formulario) {
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
    } else if (!soloDigitos(datos.dni) || datos.dni.length < 7) {
        errores.dni = ['El DNI tiene que tener 7 u 8 números, sin puntos.'];
    }
    if (!datos.fecha_nacimiento) {
        errores.fecha_nacimiento = ['Indicá la fecha de nacimiento.'];
    } else if (datos.fecha_nacimiento > hoyISO()) {
        errores.fecha_nacimiento = ['La fecha de nacimiento no puede ser futura.'];
    }
    if (datos.mail && !formulario.elements.mail.checkValidity()) {
        errores.mail = ['Revisá el mail: falta la @ o el dominio.'];
    }
    obligatorio('direccion', datos.direccion, 'Indicá la dirección.');
    if (!datos.obra_social) {
        errores.obra_social = [$('pac-obra-social').value.trim()
            ? 'Elegí la obra social de la lista de sugerencias.'
            : 'Indicá la obra social.'];
    }
    obligatorio('numero_afiliado', datos.numero_afiliado, 'Indicá el número de afiliado.');
    obligatorio('cud_vencimiento', datos.cud_vencimiento, 'Indicá el vencimiento del CUD.');
    if (!datos.consentimiento) {
        errores.consentimiento = ['Sin el consentimiento firmado no se puede registrar al paciente.'];
    }

    // Tutor responsable principal (CU01 / RN-08)
    obligatorio('tutor_nombre', datos.tutor.nombre, 'Indicá el nombre del tutor.');
    obligatorio('tutor_apellido', datos.tutor.apellido, 'Indicá el apellido del tutor.');
    if (!datos.tutor.dni) {
        errores.tutor_dni = ['Indicá el DNI del tutor.'];
    } else if (!soloDigitos(datos.tutor.dni) || datos.tutor.dni.length < 7) {
        errores.tutor_dni = ['El DNI del tutor tiene que tener 7 u 8 números, sin puntos.'];
    }
    obligatorio('tutor_parentesco_id', datos.tutor.parentesco_id, 'Seleccioná el parentesco.');
    obligatorio('tutor_telefono', datos.tutor.telefono, 'Indicá un teléfono de contacto.');
    if (datos.tutor.mail && !formulario.elements.tutor_mail.checkValidity()) {
        errores.tutor_mail = ['Revisá el mail del tutor: falta la @ o el dominio.'];
    }

    return errores;
}

export function prepararFormularioPaciente({ alGuardar } = {}) {
    const formulario = $('form-paciente');
    const contenedorErrores = $('form-paciente-errores');
    const selectParentesco = $('tutor-parentesco');
    let pacienteCreadoId = null;

    const obraSocial = crearCombobox($('pac-obra-social'), {
        buscar: sugerirObrasSociales,
        mensajeVacio: 'No hay obras sociales cargadas.',
    });

    const modal = prepararModal({
        modal: $('modal-paciente'),
        formulario,
        contenedorErrores,
        comboboxes: [obraSocial],
        alAbrir: () => {
            $('pac-nacimiento').max = hoyISO();
            pacienteCreadoId = null;
            cargarOpcionesParentescos(selectParentesco);
        },
    });

    let enviando = false;

    formulario.addEventListener('submit', async (evento) => {
        evento.preventDefault();
        if (enviando) {
            return;
        }
        enviando = true;
        const campo = (nombre) => formulario.elements[nombre]?.value?.trim() ?? '';
        const datos = {
            nombre: campo('nombre'),
            apellido: campo('apellido'),
            dni: campo('dni'),
            fecha_nacimiento: campo('fecha_nacimiento'),
            mail: campo('mail') || null,
            direccion: campo('direccion'),
            obra_social: obraSocial.valor(),
            numero_afiliado: campo('numero_afiliado'),
            cud_numero: campo('cud_numero') || null,
            cud_vencimiento: campo('cud_vencimiento'),
            consentimiento: formulario.elements.consentimiento.checked,
            tutor: {
                nombre: campo('tutor_nombre'),
                apellido: campo('tutor_apellido'),
                dni: campo('tutor_dni'),
                parentesco_id: Number(campo('tutor_parentesco_id')) || null,
                telefono: campo('tutor_telefono'),
                movil: campo('tutor_movil') || null,
                mail: campo('tutor_mail') || null,
                domicilio: campo('tutor_domicilio') || campo('direccion') || null,
                responsable_principal: true,
            },
        };

        try {
            await guardar({
                formulario,
                contenedorErrores,
                boton: $('btn-guardar-paciente'),
                errores: validar(datos, formulario),
                enviar: async () => {
                let resultadoPaciente;
                if (!pacienteCreadoId) {
                    resultadoPaciente = await pacientes.crear({
                        nombre: datos.nombre,
                        apellido: datos.apellido,
                        dni: datos.dni,
                        fecha_nacimiento: datos.fecha_nacimiento,
                        mail: datos.mail,
                        direccion: datos.direccion,
                        obra_social: datos.obra_social,
                        numero_afiliado: datos.numero_afiliado,
                        cud_numero: datos.cud_numero,
                        cud_vencimiento: datos.cud_vencimiento,
                        consentimiento: datos.consentimiento,
                    });
                    pacienteCreadoId = resultadoPaciente.id_paciente;
                } else {
                    resultadoPaciente = { id_paciente: pacienteCreadoId };
                }

                try {
                    await tutores.crear({
                        nombre: datos.tutor.nombre,
                        apellido: datos.tutor.apellido,
                        dni: datos.tutor.dni,
                        parentesco_id: datos.tutor.parentesco_id,
                        telefono: datos.tutor.telefono,
                        movil: datos.tutor.movil,
                        mail: datos.tutor.mail,
                        domicilio: datos.tutor.domicilio,
                        paciente_id: pacienteCreadoId,
                        responsable_principal: true,
                    });
                } catch (errorTutor) {
                    const deCampo = {};
                    for (const [clave, valor] of Object.entries(errorTutor.erroresDeCampo || {})) {
                        const claveNormalizada = (clave === 'parentesco' || clave === 'parentesco_id') ? 'parentesco_id' : clave;
                        deCampo[`tutor_${claveNormalizada}`] = valor;
                    }
                    throw new ApiError(errorTutor.status, deCampo);
                }

                pacienteCreadoId = null;
                return resultadoPaciente;
            },
            mensajeExito: 'El paciente y su tutor responsable quedaron registrados exitosamente.',
                modal,
                alGuardar,
            });
        } finally {
            enviando = false;
        }
    });

    return () => modal().show();
}
