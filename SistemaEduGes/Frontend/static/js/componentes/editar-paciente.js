import { catalogos, pacientes } from '../endpoints.js';
import { prepararModal, guardar } from './formularios.js';
import { notificarError } from '../ui.js';

const CAMPOS = ['nombre', 'apellido', 'dni', 'fecha_nacimiento', 'direccion', 'mail',
    'cud_numero', 'cud_vencimiento', 'obra_social', 'numero_afiliado'];

export function prepararEdicionPaciente({ alGuardar, alCerrar }) {
    const modalEl = document.getElementById('modal-editar-paciente');
    const formulario = document.getElementById('form-editar-paciente');
    const boton = document.getElementById('btn-guardar-editar-paciente');
    const errores = document.getElementById('editar-paciente-errores');
    let paciente = null;
    let peticion = 0;
    let cargado = false;
    let guardando = false;
    const modal = prepararModal({ modal: modalEl, formulario, contenedorErrores: errores });

    modalEl.addEventListener('hide.bs.modal', (evento) => {
        if (guardando) evento.preventDefault();
    });
    modalEl.addEventListener('hidden.bs.modal', () => {
        peticion++;
        cargado = false;
        const id = paciente?.id_paciente;
        paciente = null;
        alCerrar(id);
    });
    formulario.addEventListener('submit', async (evento) => {
        evento.preventDefault();
        if (!paciente || !cargado || guardando) return;
        const actual = paciente;
        const cambios = {};
        for (const campo of CAMPOS) {
            const texto = formulario.elements[campo].value.trim();
            const valor = campo === 'obra_social' ? Number(texto) : texto || (
                ['mail', 'cud_numero', 'cud_vencimiento'].includes(campo) ? null : '');
            const original = campo === 'obra_social' ? actual.obra_social.id : actual[campo] ?? null;
            if (valor !== original) cambios[campo] = valor;
        }
        guardando = true;
        await guardar({
            formulario, contenedorErrores: errores, boton, errores: {},
            enviar: () => pacientes.actualizar(actual.id_paciente, cambios),
            mensajeExito: 'Los datos del paciente se actualizaron.',
            modal: () => ({ hide() { guardando = false; modal().hide(); } }),
            alGuardar,
        });
        guardando = false;
    });

    return async (actual) => {
        if (guardando) return;
        const solicitud = ++peticion;
        paciente = actual;
        cargado = false;
        boton.disabled = true;
        modal().show();
        CAMPOS.filter(c => c !== 'obra_social').forEach(c => {
            formulario.elements[c].value = actual[c] ?? '';
        });
        const select = formulario.elements.obra_social;
        select.replaceChildren();
        try {
            const obras = await catalogos.obrasSociales();
            if (solicitud !== peticion) return;
            // Conservar la cobertura actual aunque ya no esté activa para nuevas asignaciones.
            const opciones = obras.some(o => o.id === actual.obra_social.id)
                ? obras : [actual.obra_social, ...obras];
            opciones.forEach(obra => {
                const opcion = document.createElement('option');
                opcion.value = obra.id;
                opcion.textContent = obra.nombre;
                select.appendChild(opcion);
            });
            select.value = String(actual.obra_social.id);
            cargado = true;
            boton.disabled = false;
        } catch (error) {
            if (solicitud === peticion) notificarError(error);
        }
    };
}
