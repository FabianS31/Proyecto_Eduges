// DOM y transporte simulados: no abre navegador ni realiza conexiones.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '../SistemaEduGes/Frontend/static/js');
const leer = p => fs.readFileSync(path.join(root, p), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function entorno() {
    const nodes = new Map(), calls = [], errors = [], notices = [];
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, {
            value: '', disabled: false, handlers: {}, children: [], resets: 0,
            addEventListener(name, fn) { this.handlers[name] = fn; },
            reset() { this.resets++; }, focus() {}, checkValidity() { return true; },
            appendChild(child) { this.children.push(child); },
            set innerHTML(value) { this.content = value; this.value = ''; this.children = []; },
        });
        return nodes.get(id);
    };
    const ctx = vm.createContext({
        document: { getElementById: node, createElement: () => ({}) },
        window: { bootstrap: { Modal: { getOrCreateInstance: () => ({ hide() { ctx.closed++; } }) } } },
        api: {
            async post(url, data) { calls.push({url, data: plain(data)}); return ctx.reply(); },
            async get(url) { calls.push({url}); return ctx.catalog(); },
        },
        ESTADO_PACIENTE: {}, closed: 0, reply: async () => ({}), catalog: async () => [],
        botonCargando: (btn, value) => { btn.disabled = value; },
        notificar: text => notices.push(text), notificarError: err => errors.push(err),
        renderizar() {}, html: () => '', $: node,
        prepararMostrarPassword() {}, capitalizar: s => s, normalizarTexto: s => s.toLowerCase(),
        prepararModal: options => { ctx.modal = options; return () => ({show() {}}); },
        guardar: options => { ctx.save = options; }, cargarListado: async () => {},
    });
    vm.runInContext(leer('endpoints.js').replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), ctx);
    const layout = leer('layout.js');
    vm.runInContext(layout.slice(layout.indexOf('function prepararModalEspecialidad()'),
        layout.indexOf('function inicializarDesplegablesNav()')), ctx);
    return {ctx, node, calls, errors, notices};
}
for (const tipo of ['administrador', 'especialidad']) {
    function preparar() {
        const e = entorno(), admin = tipo === 'administrador';
        e.node('especialidad-nombre').value = ' Nueva ';
        e.node('nuevo-usuario-nombre').value = 'nuevo_admin';
        e.node('nuevo-usuario-password').value = 'ClaveFicticia123';
        e.node('nuevo-usuario-password-confirm').value = 'ClaveFicticia123';
        vm.runInContext(admin ? 'prepararModalNuevoUsuario()' : 'prepararModalEspecialidad()', e.ctx);
        e.form = e.node(admin ? 'form-nuevo-usuario' : 'form-nueva-especialidad');
        e.submit = () => e.form.handlers.submit({preventDefault() {}});
        return e;
    }
    test(`${tipo}: espera persistencia, evita doble envío y usa contrato real`, async () => {
        const e = preparar(); let resolve;
        e.ctx.reply = () => new Promise(r => { resolve = r; });
        const pending = e.submit();
        await e.submit();
        assert.equal(e.calls.length, 1);
        assert.equal(e.notices.length, 0);
        assert.equal(e.ctx.closed, 0);
        resolve({}); await pending;
        assert.equal(e.ctx.closed, 1); assert.equal(e.notices.length, 1);
        assert.deepEqual(e.calls[0], tipo === 'administrador'
            ? {url: '/auth/administradores/', data: {usuario: 'nuevo_admin', password: 'ClaveFicticia123'}}
            : {url: '/profesionales/especialidades/', data: {nombre: 'Nueva'}});
    });
    test(`${tipo}: error conserva formulario, no anuncia éxito y permite reintento`, async () => {
        const e = preparar();
        e.ctx.reply = async () => { throw new Error('400/403/500 o red'); };
        await e.submit();
        assert.equal(e.ctx.closed, 0); assert.equal(e.form.resets, 0);
        assert.equal(e.errors.length, 1); assert.equal(e.notices.length, 0);
        e.ctx.reply = async () => ({}); await e.submit();
        assert.equal(e.notices.length, 1);
    });
    test(`${tipo}: campos inválidos no envían`, async () => {
        const e = preparar();
        e.node('especialidad-nombre').value = '   ';
        e.node('nuevo-usuario-password-confirm').value = 'distinta';
        await e.submit(); assert.equal(e.calls.length, 0);
    });
}
function profesional() {
    const e = entorno();
    const source = leer('paginas/profesionales.js');
    vm.runInContext(source.slice(source.indexOf('let modalAlta = null;'), source.indexOf('function cambiarFiltros(')), e.ctx);
    const form = e.node('form-nuevo-profesional');
    form.elements = {};
    for (const [k, value] of Object.entries({nombre:'Nombre', apellido:'Apellido', dni:'12345678', matricula:'M1',
        especialidad:'', contacto:'', mail:'', usuario:'usuario', password:'ClaveFicticia123', password_confirm:'ClaveFicticia123'})) {
        form.elements[k] = k === 'especialidad' ? e.node('nuevo-prof-especialidad') : {value, checkValidity: () => true};
    }
    vm.runInContext('prepararAlta()', e.ctx);
    e.submit = () => form.handlers.submit({preventDefault() {}});
    return e;
}
test('profesional: catálogo real, texto seguro y credenciales en una única alta', async () => {
    const e = profesional();
    e.ctx.catalog = async () => [{id: 47, nombre: '<b>Especialidad</b>'}];
    await e.ctx.modal.alAbrir();
    assert.equal(e.calls[0].url, '/profesionales/especialidades/');
    assert.equal(e.node('nuevo-prof-especialidad').children[0].textContent, '<b>Especialidad</b>');
    e.submit(); assert.deepEqual(plain(e.ctx.save.errores), {});
    await e.ctx.save.enviar();
    const alta = e.calls[1];
    assert.equal(alta.url, '/profesionales/'); assert.equal(alta.data.especialidad, 47);
    assert.equal(alta.data.usuario, 'usuario'); assert.equal(alta.data.password, 'ClaveFicticia123');
    assert.ok(!('password_confirm' in alta.data));
});
test('profesional: catálogo vacío o fallido nunca vuelve al ID fijo ni conserva selección', async () => {
    const e = profesional();
    for (const falla of [false, true]) {
        e.node('nuevo-prof-especialidad').value = '47';
        e.ctx.catalog = async () => { if (falla) throw new Error('red'); return []; };
        await e.ctx.modal.alAbrir(); e.submit();
        assert.ok(e.ctx.save.errores.especialidad);
        assert.equal(e.node('nuevo-prof-especialidad').value, '');
    }
});
