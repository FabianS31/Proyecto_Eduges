import { catalogos, pacientes } from '../endpoints.js';
import { validarCud, validarCamposPreventivos, errorDomicilio, prepararModal, guardar } from './formularios.js';
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
            const entrada = formulario.elements[campo].value;
            const previo = campo === 'obra_social' ? String(actual.obra_social.id) : String(actual[campo] ?? '');
            if (entrada === previo) continue;
            const texto = campo === 'dni' ? entrada : entrada.trim();
            const valor = campo === 'obra_social' ? Number(texto) : texto || (
                ['mail', 'cud_numero', 'cud_vencimiento'].includes(campo) ? null : '');
            const original = campo === 'obra_social' ? actual.obra_social.id : actual[campo] ?? null;
            if (valor !== original) cambios[campo] = valor;
        }
        guardando = true;
        const validaciones = validarCamposPreventivos(cambios, {
            nombre: { requerido: true, max: 100 }, apellido: { requerido: true, max: 100 },
            dni: { requerido: true, max: 20 }, direccion: { requerido: true, max: 255 },
            numero_afiliado: { requerido: true, max: 20 }, mail: { max: 50, tipo: 'email' },
            cud_numero: { max: 20 }, cud_vencimiento: { tipo: 'fecha' },
            fecha_nacimiento: { requerido: true, tipo: 'nacimiento' },
            obra_social: { requerido: true },
        });
        for (const campo of ['nombre', 'apellido']) {
            if (Object.hasOwn(cambios, campo) && !/\p{L}/u.test(cambios[campo])) {
                validaciones[campo] = ['Debe contener al menos una letra; no puede ser solo números o símbolos.'];
            }
        }
        Object.assign(validaciones, validarCud(cambios, actual));
        if (formulario.elements.cud_vencimiento.validity?.badInput) {
            validaciones.cud_vencimiento = ['Ingresá una fecha válida.'];
        }
        if (Object.hasOwn(cambios, 'dni') && !/^[0-9]{7,8}$/.test(cambios.dni)) {
            validaciones.dni = ['El DNI debe tener 7 u 8 números, sin puntos.'];
        }
        if (Object.hasOwn(cambios, 'direccion') && errorDomicilio(cambios.direccion)) {
            validaciones.direccion = [errorDomicilio(cambios.direccion)];
        }
        await guardar({
            formulario, contenedorErrores: errores, boton, errores: validaciones,
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
