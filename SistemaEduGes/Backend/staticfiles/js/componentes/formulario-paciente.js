// ============================================================
// EduGes - Formulario "Nuevo paciente" (templates/componentes/modal_paciente.html)
// Lo usan el dashboard y la página de Pacientes.
//
//   const abrirNuevoPaciente = prepararFormularioPaciente({
//       alGuardar: (pacienteCreado) => { ... },
//   });
//   boton.addEventListener('click', abrirNuevoPaciente);
//
// Endpoint: POST /api/pacientes/ (pacientes.crear). La obra social se elige de
// las sugerencias (catalogos.obrasSociales, todavía sin API).
// ============================================================

import { catalogos, pacientes } from '../endpoints.js';
import { hoyISO } from '../fechas.js';
import { buscarEnLista, crearCombobox } from './combobox.js';
import { guardar, prepararModal } from './formularios.js';

const $ = (id) => document.getElementById(id);

const soloDigitos = (texto) => /^\d+$/.test(texto);

async function sugerirObrasSociales(texto) {
    const opciones = (await catalogos.obrasSociales()).map((item) => ({ valor: item.id, texto: item.nombre }));
    return buscarEnLista(opciones)(texto);
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
    return errores;
}

export function prepararFormularioPaciente({ alGuardar } = {}) {
    const formulario = $('form-paciente');
    const contenedorErrores = $('form-paciente-errores');
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
        },
    });

    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        const campo = (nombre) => formulario.elements[nombre].value.trim();
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
        };
        guardar({
            formulario,
            contenedorErrores,
            boton: $('btn-guardar-paciente'),
            errores: validar(datos, formulario),
            enviar: () => pacientes.crear(datos),
            mensajeExito: 'El paciente quedó registrado y asignado a vos.',
            modal,
            alGuardar,
        });
    });

    return () => modal().show();
}
