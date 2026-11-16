const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const codigo = fs.readFileSync('SistemaEduGes/Frontend/static/js/componentes/sesion-modal.js', 'utf8')
    .replace(/^import .*;$/gm, '').replace('export function', 'function');
const esperar = () => new Promise(resolve => setImmediate(resolve));

function entorno() {
    const nodos = new Map(), llamadas = [];
    const nodo = id => {
        if (!nodos.has(id)) nodos.set(id, {
            value: '', hidden: false, eventos: {}, classList: {contains: () => false},
            addEventListener(nombre, fn) { this.eventos[nombre] = fn; },
            setCustomValidity(mensaje) { this.error = mensaje; }, reportValidity() {},
        });
        return nodos.get(id);
    };
    const ctx = vm.createContext({
        console: {error() {}, warn() {}},
        document: {getElementById: nodo},
        window: {bootstrap: {Modal: {getOrCreateInstance: () => ({show() {}, hide() {}})}}},
        prepararModal: () => () => ({show() {}, hide() {}}),
        sesiones: {pendientes: async filtros => { llamadas.push(filtros); return ctx.responder(); }},
        responder: () => [],
        crearCombobox: (input, opciones) => {
            ctx.opciones = opciones;
            return ctx.combo = {seleccion: null, valor() {return this.seleccion;},
                limpiar() {this.seleccion = null; input.value = '';}};
        },
        buscarEnLista: opciones => async texto => opciones.filter(o => o.texto.toLowerCase().includes(texto.toLowerCase())),
        nombreCompleto: p => `${p.nombre} ${p.apellido}`,
        formatearFecha: x => x, formatearHora: x => x, icono: () => '',
        html: (partes, ...valores) => partes.reduce((s, p, i) => s + p + (valores[i] ?? ''), ''),
        renderizar: (n, texto) => n.contenido = String(texto),
    });
    vm.runInContext(codigo + '\nvar modal = prepararModalSesion({usuario:{rol:{nombre:"Profesional"}}});', ctx);
    return {ctx, nodo, llamadas};
}
const turno = (id, fecha = '2026-11-16') => ({id, fecha, hora:'09:00',
    paciente:{id, nombre:'Ana', apellido:'Pérez'}, estado:{nombre:'Confirmado'}});

test('sugerencias usan solo pendientes autorizados, sin catálogo general; distinguen homónimos y deduplican', async () => {
    const e = entorno(); e.ctx.responder = () => [turno(1), turno(1), turno(2, '2026-11-17')];
    e.nodo('pend-fecha-desde').value = '2026-11-01';
    const opciones = await e.ctx.opciones.buscar('Ana');
    assert.equal(opciones.length, 2);
    assert.notEqual(opciones[0].detalle, opciones[1].detalle);
    assert.equal(e.llamadas[0].fecha_desde, '2026-11-01');
    assert.equal(e.llamadas[0].paciente_id, undefined);
    e.ctx.responder = () => [];
    assert.equal((await e.ctx.opciones.buscar('Ana')).length, 0);
});

test('selección consulta el ID interno y conserva fechas', async () => {
    const e = entorno(); e.ctx.combo.seleccion = 2; e.nodo('pend-paciente').value = 'Ana Pérez';
    e.nodo('pend-fecha-hasta').value = '2026-11-30';
    e.ctx.modal.abrirPendientes(); await esperar();
    assert.equal(e.llamadas[0].paciente_id, 2);
    assert.equal(e.llamadas[0].fecha_hasta, '2026-11-30');
});

test('texto sin seleccionar no se convierte en ID ni dispara una consulta sin filtro', async () => {
    const e = entorno(); e.nodo('pend-paciente').value = 'Ana';
    e.ctx.modal.abrirPendientes(); await esperar();
    assert.equal(e.llamadas.length, 0);
    assert.match(e.nodo('pend-paciente').error, /Seleccioná/);
});

test('limpiar restaura consulta sin paciente ni fechas', async () => {
    const e = entorno(); e.ctx.combo.seleccion = 2; e.nodo('pend-paciente').value = 'Ana';
    e.nodo('pend-fecha-desde').value = '2026-11-01';
    e.nodo('btn-limpiar-filtros-pend').eventos.click(); await esperar();
    assert.equal(e.ctx.combo.valor(), null);
    assert.equal(e.llamadas[0].paciente_id, undefined);
    assert.equal(e.llamadas[0].fecha_desde, undefined);
});

test('denegación de sugerencias no reutiliza catálogo anterior', async () => {
    const e = entorno(); e.ctx.responder = () => [turno(1)];
    await e.ctx.opciones.buscar('Ana');
    e.ctx.responder = () => {throw {status:403};};
    await assert.rejects(e.ctx.opciones.buscar('Ana'), error => error.status === 403);
});

test('cerrar el modal limpia la selección', () => {
    const e = entorno(); e.ctx.combo.seleccion = 1; e.nodo('pend-paciente').value = 'Ana';
    e.nodo('modal-sesiones-pendientes').eventos['hidden.bs.modal']();
    assert.equal(e.ctx.combo.valor(), null);
    assert.equal(e.nodo('pend-paciente').value, '');
});
