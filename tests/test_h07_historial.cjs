const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const codigo = fs.readFileSync('SistemaEduGes/Frontend/static/js/componentes/historial-clinico.js', 'utf8')
    .replace(/^import .*;$/gm, '').replace('export function', 'function');

function entorno() {
    const eventos = {}, documento = {}, llamadas = [], intervalos = new Map();
    const contenedor = { contenido: '', querySelector: () => ({ addEventListener: (_, fn) => { contenedor.reintentar = fn; } }) };
    const ctx = vm.createContext({
        document: { hidden: false, hasFocus: () => true, addEventListener: (n, f) => documento[n] = f },
        window: { addEventListener: (n, f) => eventos[n] = f },
        sesiones: { historial: async id => { llamadas.push(id); return ctx.respuesta(id); } },
        respuesta: async () => [],
        renderizar: (c, contenido) => c.contenido = String(contenido),
        bloqueCargando: () => 'Cargando',
        html: (strings, ...valores) => strings.reduce((s, v, i) => s + v + (Array.isArray(valores[i]) ? valores[i].join('') : valores[i] ?? ''), ''),
        diaEnTexto: s => s, formatearHora: s => s,
        setInterval: fn => { intervalos.set(1, fn); return 1; }, clearInterval: id => intervalos.delete(id),
        contenedor,
    });
    const ui = fs.readFileSync('SistemaEduGes/Frontend/static/js/ui.js', 'utf8');
    vm.runInContext(ui.slice(ui.indexOf('class HtmlSeguro'), ui.indexOf('// Reemplaza el contenido'))
        .replace(/\bexport /g, ''), ctx);
    vm.runInContext(codigo + '\nvar historial = crearHistorialClinico(() => contenedor);', ctx);
    return { ctx, eventos, documento, llamadas, intervalos, contenedor, h: ctx.historial };
}
const fila = (id=1) => ({ turno_id: id, fecha: '2026-11-14', hora: '09:00',
    profesional: { id: 2, nombre: 'Autora', apellido: 'Anterior' },
    sesion: { id, diagnostico: `Diagnóstico ${id}`, trabajo_sesion: 'PRIVADO', nota_sesion: 'PRIVADO' } });

test('historial usa endpoint propio, muestra mas de diez diagnosticos y autor sin campos privados', async () => {
    const e = entorno(); e.ctx.respuesta = async () => Array.from({length: 13}, (_, i) => fila(i+1));
    await e.h.abrir(7);
    assert.deepEqual(e.llamadas, [7]);
    assert.match(e.contenedor.contenido, /Diagnóstico 13/);
    assert.match(e.contenedor.contenido, /Autora Anterior/);
    assert.doesNotMatch(e.contenedor.contenido, /PRIVADO|Modificar|data-accion/);
});

test('vacio, permisos, expiracion, error y respuesta invalida se distinguen y limpian anteriores', async () => {
    const e = entorno(); await e.h.abrir(7);
    assert.match(e.contenedor.contenido, /No hay sesiones/);
    for (const [status, texto] of [[403, /autorización/], [401, /expiró/], [500, /No se pudo/], [0, /No se pudo/]]) {
        e.ctx.respuesta = async () => [fila()]; await e.h.recargar();
        e.ctx.respuesta = async () => { throw {status}; }; await e.h.recargar();
        assert.match(e.contenedor.contenido, texto);
        assert.doesNotMatch(e.contenedor.contenido, /Diagnóstico 1|No hay sesiones/);
    }
    e.ctx.respuesta = async () => null; await e.h.recargar();
    assert.match(e.contenedor.contenido, /No se pudo/);
    e.ctx.respuesta = async () => [fila()]; await e.contenedor.reintentar();
    assert.match(e.contenedor.contenido, /Diagnóstico 1/);
});

test('cierre o cambio de paciente invalida respuestas tardias', async () => {
    const e = entorno(); let resolver;
    e.ctx.respuesta = () => new Promise(r => resolver = r);
    const pendiente = e.h.abrir(7); e.h.cerrar(); resolver([fila()]); await pendiente;
    assert.equal(e.contenedor.contenido, ''); assert.equal(e.intervalos.size, 0);
    const anterior = e.h.abrir(7);
    e.ctx.respuesta = async () => [fila(2)]; await e.h.abrir(8);
    resolver([fila(1)]); await anterior;
    assert.doesNotMatch(e.contenedor.contenido, /Diagnóstico 1/);
    assert.match(e.contenedor.contenido, /Diagnóstico 2/);
});

test('ocultar, perder foco y salir limpian; volver y temporizador revalidan revocacion', async () => {
    const e = entorno(); e.ctx.respuesta = async () => [fila()]; await e.h.abrir(7);
    e.eventos.blur(); assert.equal(e.contenedor.contenido, '');
    await e.eventos.focus(); assert.match(e.contenedor.contenido, /Diagnóstico 1/);
    e.ctx.document.hidden = true; e.documento.visibilitychange(); assert.equal(e.contenedor.contenido, '');
    e.ctx.document.hidden = false; await e.documento.visibilitychange();
    e.ctx.respuesta = async () => { throw {status: 403}; }; await e.intervalos.get(1)();
    assert.doesNotMatch(e.contenedor.contenido, /Diagnóstico 1/);
    e.eventos.pagehide(); assert.equal(e.contenedor.contenido, '');
});

test('endpoint GET conserva POST y no memoriza resultados', async () => {
    const llamadas = [];
    const ctx = vm.createContext({ api: {get: async (...args) => { llamadas.push(args); return []; },
        post: async (...args) => { llamadas.push(args); }}, ESTADO_PACIENTE: {} });
    const source = fs.readFileSync('SistemaEduGes/Frontend/static/js/endpoints.js', 'utf8')
        .replace(/^import[\s\S]*?;\s*$/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, ctx);
    await vm.runInContext('sesiones.historial(7)', ctx);
    await vm.runInContext('sesiones.historial(7)', ctx);
    assert.equal(llamadas.length, 2);
    assert.equal(llamadas[0][0], '/sesiones/');
    assert.equal(llamadas[0][1].parametros.paciente_id, 7);
    await vm.runInContext('sesiones.crear({turno_id: 9})', ctx);
    assert.equal(llamadas[2][0], '/sesiones/');
    assert.equal(llamadas[2][1].turno_id, 9);
});

test('diagnostico y autor se escapan como texto usando el HTML seguro real', async () => {
    const e = entorno(), registro = fila();
    registro.sesion.diagnostico = '<script>privado()</script>';
    registro.profesional.nombre = '<img src=x onerror=alert(1)>';
    e.ctx.respuesta = async () => [registro]; await e.h.abrir(7);
    assert.doesNotMatch(e.contenedor.contenido, /<script>|<img/);
    assert.match(e.contenedor.contenido, /&lt;script&gt;/);
    assert.match(e.contenedor.contenido, /&lt;img/);
});
