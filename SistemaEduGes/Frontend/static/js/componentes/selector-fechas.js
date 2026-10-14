// ============================================================
// EduGes - Calendario para elegir varias fechas (RF-15 / CU19)
// Muestra un mes; cada día es un botón que se marca o desmarca.
// Solo se pueden elegir días entre "desde" y "hasta" (fuera del rango quedan deshabilitados).
//
//   const selector = crearSelectorFechas(contenedor, { desde: '2026-10-14', hasta: '2026-11-13' });
//   selector.fechas();      // ['2026-10-16', '2026-10-23'] ordenadas
//   selector.limpiar();
//
// Accesible: cada botón lleva la fecha completa para el lector de pantalla y aria-pressed;
// debajo, un resumen en texto de lo elegido que se anuncia al cambiar.
// ============================================================

import { aFecha } from '../fechas.js';
import { html, renderizar } from '../ui.js';

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const FORMATO_MES = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' });
const FORMATO_DIA_LARGO = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
const FORMATO_DIA_CORTO = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' });

const iso = (anio, mes, dia) => `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
const conMayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

let contador = 0;

export function crearSelectorFechas(contenedor, { desde, hasta, alCambiar = () => {} }) {
    const id = `selector-fechas-${++contador}`;
    const elegidas = new Set();
    const inicio = aFecha(desde);
    const fin = aFecha(hasta);
    let anio = inicio.getFullYear();
    let mes = inicio.getMonth();

    function dibujar() {
        const primerDia = new Date(anio, mes, 1);
        const diasDelMes = new Date(anio, mes + 1, 0).getDate();
        // Lunes = 0 … domingo = 6
        const huecos = (primerDia.getDay() + 6) % 7;
        const nombreMes = conMayuscula(FORMATO_MES.format(primerDia));
        const hayAnterior = new Date(anio, mes, 1) > new Date(inicio.getFullYear(), inicio.getMonth(), 1);
        const haySiguiente = new Date(anio, mes + 1, 1) <= fin;

        const celdas = [];
        for (let i = 0; i < huecos; i++) {
            celdas.push(html`<span aria-hidden="true"></span>`);
        }
        for (let dia = 1; dia <= diasDelMes; dia++) {
            const fecha = iso(anio, mes, dia);
            const habilitado = fecha >= desde && fecha <= hasta;
            const marcado = elegidas.has(fecha);
            celdas.push(html`
                <button type="button" class="selector-fechas-dia${marcado ? ' marcado' : ''}" data-fecha="${fecha}"
                        aria-pressed="${marcado ? 'true' : 'false'}" ${habilitado ? '' : 'disabled'}
                        aria-label="${conMayuscula(FORMATO_DIA_LARGO.format(aFecha(fecha)))}${habilitado ? '' : ' (no disponible)'}">${dia}</button>`);
        }

        const lista = [...elegidas].sort();
        renderizar(contenedor, html`
            <div class="selector-fechas" role="group" aria-labelledby="${id}-mes">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-mover="-1" ${hayAnterior ? '' : 'disabled'}>
                        <i class="bi bi-chevron-left" aria-hidden="true"></i><span class="visually-hidden">Mes anterior</span>
                    </button>
                    <span class="fw-semibold" id="${id}-mes" aria-live="polite">${nombreMes}</span>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-mover="1" ${haySiguiente ? '' : 'disabled'}>
                        <i class="bi bi-chevron-right" aria-hidden="true"></i><span class="visually-hidden">Mes siguiente</span>
                    </button>
                </div>
                <div class="selector-fechas-grilla">
                    ${DIAS_SEMANA.map((d) => html`<span class="selector-fechas-encabezado" aria-hidden="true">${d}</span>`)}
                    ${celdas}
                </div>
                <p class="small mt-2 mb-0" aria-live="polite">
                    ${lista.length === 0
                        ? html`<span class="text-muted">Tocá los días en los que querés dar turno.</span>`
                        : html`<strong>${lista.length === 1 ? '1 fecha elegida' : `${lista.length} fechas elegidas`}:</strong>
                               ${lista.map((f) => FORMATO_DIA_CORTO.format(aFecha(f))).join(' · ')}`}
                </p>
            </div>`);
    }

    contenedor.addEventListener('click', (evento) => {
        const dia = evento.target.closest('[data-fecha]');
        const mover = evento.target.closest('[data-mover]');
        if (dia && !dia.disabled) {
            const fecha = dia.dataset.fecha;
            if (elegidas.has(fecha)) {
                elegidas.delete(fecha);
            } else {
                elegidas.add(fecha);
            }
            dibujar();
            // El botón se redibuja: el foco vuelve al mismo día
            contenedor.querySelector(`[data-fecha="${fecha}"]`)?.focus();
            alCambiar([...elegidas].sort());
        } else if (mover && !mover.disabled) {
            const paso = Number(mover.dataset.mover);
            const nueva = new Date(anio, mes + paso, 1);
            anio = nueva.getFullYear();
            mes = nueva.getMonth();
            dibujar();
            contenedor.querySelector(`[data-mover="${paso}"]:not([disabled])`)?.focus();
        }
    });

    dibujar();

    return {
        fechas: () => [...elegidas].sort(),
        limpiar() {
            elegidas.clear();
            anio = inicio.getFullYear();
            mes = inicio.getMonth();
            dibujar();
        },
    };
}
