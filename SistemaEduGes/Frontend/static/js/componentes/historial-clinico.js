import { sesiones } from '../endpoints.js';
import { bloqueCargando, html, renderizar } from '../ui.js';
import { diaEnTexto, formatearHora } from './turnos.js';

// Solo resúmenes. No guarda respuestas clínicas en mapas, storage ni cachés.
export function crearHistorialClinico(obtenerContenedor) {
    let pacienteId = null;
    let peticion = 0;
    let intervalo = null;

    function limpiar() {
        ++peticion;
        const contenedor = obtenerContenedor();
        if (contenedor) renderizar(contenedor, '');
    }

    async function recargar() {
        limpiar();
        const id = pacienteId;
        const contenedor = obtenerContenedor();
        if (!id || !contenedor || document.hidden || !document.hasFocus()) return;
        const solicitud = peticion;
        renderizar(contenedor, bloqueCargando(1));
        try {
            const registros = await sesiones.historial(id);
            if (solicitud !== peticion || pacienteId !== id || obtenerContenedor() !== contenedor) return;
            if (!Array.isArray(registros)) throw new Error('Respuesta de historial inválida.');
            renderizar(contenedor, html`
                <p class="small text-muted">${registros.length} sesiones registradas. Los detalles propios se consultan desde los turnos.</p>
                ${registros.length ? registros.map((r) => html`
                    <article class="p-3 mb-3 border rounded">
                        <h4 class="fs-6">${diaEnTexto(r.fecha)}, ${formatearHora(r.hora)} hs</h4>
                        <p class="small">Profesional: ${r.profesional.nombre} ${r.profesional.apellido}</p>
                        <strong>Diagnóstico clínico</strong>
                        <p style="white-space: pre-wrap;">${r.sesion.diagnostico}</p>
                    </article>`) : html`<p>No hay sesiones clínicas registradas para este paciente.</p>`}
            `);
        } catch (error) {
            if (solicitud !== peticion || pacienteId !== id || obtenerContenedor() !== contenedor) return;
            const mensaje = error.status === 403
                ? 'No tenés autorización para consultar el historial de este paciente.'
                : error.status === 401
                    ? 'Tu sesión expiró. Volvé a iniciar sesión.'
                    : 'No se pudo consultar el historial. Intentá nuevamente.';
            renderizar(contenedor, html`<div role="alert">${mensaje}</div>
                <button type="button" class="eg-btn eg-btn--ghost" data-reintentar-historial>Reintentar</button>`);
            contenedor.querySelector('[data-reintentar-historial]')?.addEventListener('click', recargar);
        }
    }

    function cerrar() {
        pacienteId = null;
        clearInterval(intervalo);
        intervalo = null;
        limpiar();
    }

    window.addEventListener('blur', limpiar);
    window.addEventListener('focus', recargar);
    window.addEventListener('pagehide', cerrar);
    document.addEventListener('visibilitychange', () => document.hidden ? limpiar() : recargar());

    return {
        abrir(id) {
            cerrar();
            pacienteId = id;
            // Revalidar también si la asignación cambia en otra sesión.
            intervalo = setInterval(recargar, 30000);
            return recargar();
        },
        recargar,
        cerrar,
    };
}
