// ============================================================
// EduGes - Aviso de cierre de sesión por inactividad
//
// La API cierra la sesión tras 20 minutos sin peticiones (cada petición reinicia
// el contador). Para que nadie pierda lo que está escribiendo:
//   - Si la persona está usando la pantalla (teclado, mouse, toques) pero no hubo
//     peticiones en un rato, se le avisa al servidor que sigue ahí (GET /api/auth/me/).
//   - Si de verdad no hay uso, 2 minutos antes del cierre aparece "¿Seguís ahí?"
//     con cuenta regresiva y el botón "Seguir conectado".
//   - Al llegar a los 20 minutos, se va al login explicando por qué.
//
// La hora de la última petición se comparte entre pestañas (localStorage):
// usar EduGes en una pestaña mantiene la sesión de todas.
// api.js avisa cada respuesta con el evento "eduges:respuesta".
// ============================================================

import { CONFIG } from './config.js';
import { auth } from './endpoints.js';
import { html, renderizar } from './ui.js';

const DURACION_MS = 20 * 60 * 1000;          // la misma que la API
const AVISO_ANTES_MS = 2 * 60 * 1000;        // el aviso aparece a los 18 minutos
const MANTENER_CADA_MS = 4 * 60 * 1000;      // con uso de la pantalla, se avisa al servidor como mucho cada 4 minutos
const CLAVE = 'eduges:ultima-peticion';
const EVENTOS_DE_USO = ['keydown', 'pointerdown', 'wheel', 'touchstart', 'input'];

let ultimaLocal = Date.now();    // por si el navegador no deja usar localStorage
let ultimoUso = 0;
let avisando = false;            // pedido al servidor en curso
let dialogo = null;
let alSalir = null;

function guardarUltimaPeticion(momento) {
    ultimaLocal = momento;
    try {
        window.localStorage.setItem(CLAVE, String(momento));
    } catch {
        // Sin localStorage (modo privado, bloqueado): cada pestaña lleva su propia cuenta
    }
}

function leerUltimaPeticion() {
    try {
        const guardada = Number(window.localStorage.getItem(CLAVE));
        if (guardada > 0) {
            return guardada;
        }
    } catch {
        // idem
    }
    return ultimaLocal;
}

// "1:45"
function formatearRestante(ms) {
    const segundos = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
}

function irAlLoginPorInactividad() {
    clearInterval(intervalo);
    const siguiente = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`${CONFIG.LOGIN_URL}?next=${siguiente}&motivo=inactividad`);
}

// Una petición autenticada reinicia el contador del servidor
async function mantenerSesion() {
    if (avisando) {
        return;
    }
    avisando = true;
    try {
        await auth.me({ redirigirSi401: false });
    } catch (error) {
        if (error.status === 401) {
            irAlLoginPorInactividad();
        }
        // Sin conexión: se vuelve a intentar en la próxima revisión
    } finally {
        avisando = false;
    }
}

// ------------------------------------------------------------
// Diálogo "¿Seguís ahí?"
// ------------------------------------------------------------
function crearDialogo() {
    const elemento = document.createElement('div');
    elemento.className = 'modal fade modal-sesion';
    elemento.id = 'modal-sesion';
    elemento.tabIndex = -1;
    elemento.setAttribute('aria-labelledby', 'modal-sesion-titulo');
    elemento.setAttribute('aria-describedby', 'modal-sesion-texto');
    elemento.setAttribute('aria-hidden', 'true');
    renderizar(elemento, html`
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content border-0 shadow">
                <div class="modal-header border-0 pb-0">
                    <h2 class="modal-title fs-5 fw-bold" id="modal-sesion-titulo">
                        <span class="ms eg-icono-warn" aria-hidden="true">hourglass_empty</span>¿Seguís ahí?
                    </h2>
                </div>
                <div class="modal-body" id="modal-sesion-texto">
                    <p class="mb-2">
                        Por seguridad, tu sesión se va a cerrar en
                        <strong class="fs-5" id="modal-sesion-cuenta">2:00</strong>
                        porque no hubo actividad.
                    </p>
                    <p class="mb-0 text-muted">Si estabas escribiendo algo, tocá «Seguir conectado» para no perderlo.</p>
                </div>
                <div class="modal-footer border-0 pt-0">
                    <button type="button" class="btn btn-outline-secondary" data-accion="salir">Cerrar sesión</button>
                    <button type="button" class="btn btn-eduges" data-bs-dismiss="modal">Seguir conectado</button>
                </div>
            </div>
        </div>`);
    document.body.append(elemento);

    const modal = new window.bootstrap.Modal(elemento);
    let focoAnterior = null;
    elemento.addEventListener('show.bs.modal', () => {
        focoAnterior = document.activeElement;
    });
    elemento.addEventListener('shown.bs.modal', () => {
        // Es un aviso que pide respuesta: el lector de pantalla lo lee entero al abrirse.
        // Si hay otro modal abierto, queda por encima (lo resuelve layout.js para todos los modales).
        elemento.setAttribute('role', 'alertdialog');
        elemento.querySelector('[data-bs-dismiss="modal"]').focus();
    });
    // Cerrarlo de cualquier forma (botón, Escape) es seguir conectado: la persona está ahí
    elemento.addEventListener('hidden.bs.modal', () => {
        dialogo.abierto = false;
        mantenerSesion();
        if (focoAnterior?.isConnected && focoAnterior.checkVisibility()) {
            focoAnterior.focus();
        }
    });
    elemento.querySelector('[data-accion="salir"]').addEventListener('click', () => alSalir?.());

    return {
        abierto: false,
        abrir() {
            this.abierto = true;
            modal.show();
        },
        cerrar() {
            modal.hide();
        },
        mostrarRestante(ms) {
            elemento.querySelector('#modal-sesion-cuenta').textContent = formatearRestante(ms);
        },
    };
}

// ------------------------------------------------------------
// Revisión cada segundo
// ------------------------------------------------------------
let intervalo = null;

function revisar() {
    const ahora = Date.now();
    const ultima = leerUltimaPeticion();
    const sinPeticiones = ahora - ultima;
    const restante = DURACION_MS - sinPeticiones;

    if (restante <= 0) {
        irAlLoginPorInactividad();
        return;
    }

    if (dialogo.abierto) {
        // Otra pestaña mantuvo la sesión: el aviso ya no hace falta
        if (restante > AVISO_ANTES_MS) {
            dialogo.cerrar();
        } else {
            dialogo.mostrarRestante(restante);
        }
        return;
    }

    // La persona está usando la pantalla: se le avisa al servidor sin interrumpirla
    if (ultimoUso > ultima && sinPeticiones >= MANTENER_CADA_MS) {
        mantenerSesion();
        return;
    }

    if (restante <= AVISO_ANTES_MS) {
        dialogo.mostrarRestante(restante);
        dialogo.abrir();
    }
}

// salir: la función de cierre de sesión de layout.js (botón "Cerrar sesión" del aviso)
export function iniciarControlDeSesion({ salir }) {
    alSalir = salir;
    dialogo = crearDialogo();
    guardarUltimaPeticion(Date.now());   // se llama después de /api/auth/me/

    window.addEventListener('eduges:respuesta', () => guardarUltimaPeticion(Date.now()));
    EVENTOS_DE_USO.forEach((tipo) => document.addEventListener(tipo, () => {
        ultimoUso = Date.now();
    }, { capture: true, passive: true }));
    intervalo = setInterval(revisar, 1000);
}
