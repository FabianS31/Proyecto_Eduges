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
        renderizar(el, markup) { if (el) el.rendered = String(markup ?? ''); },
        html: (s, ...v) => s.reduce((a, p, i) => a + p + (v[i] ?? ''), ''), $: node,
        ApiError: class extends Error {},
        limpiarErroresFormulario() {},
        mostrarErroresDelFormulario: null,
        prepararMostrarPassword() {}, capitalizar: s => s, normalizarTexto: s => s.toLowerCase(),
        prepararModal: options => { ctx.modal = options; return () => ({show() {}}); },
        guardar: options => { ctx.save = options; }, cargarListado: async () => {},
    });
    vm.runInContext(leer('endpoints.js').replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), ctx);
    vm.runInContext(((s => s.slice(s.indexOf('export function errorDomicilio(')).replace(/\bexport\s+/g, ''))(leer('componentes/formularios.js'))), ctx);
    const layout = leer('layout.js');
    vm.runInContext(layout.slice(layout.indexOf('function mostrarErrorEnModal('),
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
    test(`${tipo}: error conserva formulario, renderiza dentro del modal y permite reintento`, async () => {
        const e = preparar();
        const contId = tipo === 'administrador' ? 'form-nuevo-usuario-errores' : 'form-especialidad-errores';
        e.ctx.reply = async () => { throw new Error('400/403/500 o red'); };
        await e.submit();
        assert.equal(e.ctx.closed, 0); assert.equal(e.form.resets, 0);
        assert.ok(e.node(contId).rendered.includes('400/403/500 o red'));
        assert.equal(e.errors.length, 0); assert.equal(e.notices.length, 0);
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

test('H09: administrador admite 100 caracteres y rechaza 101',async()=>{
    for(const largo of [100,101]) {
        const e=entorno();
        e.node('nuevo-usuario-nombre').value='a'.repeat(largo);
        e.node('nuevo-usuario-password').value='ClaveFicticia123';
        e.node('nuevo-usuario-password-confirm').value='ClaveFicticia123';
        vm.runInContext('prepararModalNuevoUsuario()',e.ctx);
        await e.node('form-nuevo-usuario').handlers.submit({preventDefault(){}});
        assert.equal(e.calls.length,largo===100?1:0);
    }
});


test('H14 H19: alta profesional conserva escritura y rechaza DNI sin recortar', async()=>{
    const ui=leer('ui.js');const start=ui.indexOf('export function capitalizar(');
    for(const apellido of ['McDonald',"O'Neill",'DE LA CRUZ']) {
        const e=profesional();
        vm.runInContext(ui.slice(start,ui.indexOf('\n}',start)+2).replace('export ',''),e.ctx);
        e.ctx.catalog=async()=>[{id:47,nombre:'Ficticia'}];await e.ctx.modal.alAbrir();
        const form=e.node('form-nuevo-profesional');form.elements.apellido.value=apellido;
        e.submit();assert.deepEqual(plain(e.ctx.save.errores),{});await e.ctx.save.enviar();
        assert.equal(e.calls.at(-1).data.apellido,apellido==='DE LA CRUZ'?'De La Cruz':apellido);
        for(const dni of [' 1234567','1234567 ','12.345.678','1234567\u00b2']) {
            form.elements.dni.value=dni;e.submit();assert.ok(e.ctx.save.errores.dni);
        }
    }
});


test('Etapa2 especialidad: admite 100 caracteres, rechaza 101 en el contenedor modal', async () => {
    for (const [largo, ok] of [[100, true], [101, false]]) {
        const e = entorno();
        e.node('especialidad-nombre').value = 'E'.repeat(largo);
        vm.runInContext('prepararModalEspecialidad()', e.ctx);
        await e.node('form-nueva-especialidad').handlers.submit({preventDefault() {}});
        assert.equal(e.calls.length, ok ? 1 : 0);
        if (!ok) assert.ok(e.node('form-especialidad-errores').rendered.includes('100'));
    }
});

test('Etapa2 profesional alta: matricula, contacto, mail, usuario y maxlength passwords', async () => {
    const baseValido = e => {
        const els = e.node('form-nuevo-profesional').elements;
        els.matricula.value = 'M'.repeat(50);
        els.contacto.value = '+54 (011) 1234-5678';
        els.mail.value = 'prof@example.com';
        els.usuario.value = 'u'.repeat(100);
    };
    const okEnv = profesional();
    okEnv.ctx.catalog = async () => [{id: 47, nombre: 'Psi'}];
    await okEnv.ctx.modal.alAbrir();
    baseValido(okEnv);
    okEnv.submit();
    assert.deepEqual(plain(okEnv.ctx.save.errores), {});

    for (const [campo, valor] of [['matricula', ''], ['matricula', 'M'.repeat(51)], ['contacto', 'C'.repeat(51)],
        ['mail', 'sin-arroba'], ['mail', 'a@dominio'], ['mail', 'a'.repeat(39) + '@example.com'],
        ['usuario', 'u'.repeat(101)], ['usuario', 'con espacio']]) {
        const e = profesional();
        e.ctx.catalog = async () => [{id: 47, nombre: 'Psi'}];
        await e.ctx.modal.alAbrir();
        baseValido(e);
        e.node('form-nuevo-profesional').elements[campo].value = valor;
        e.submit();
        assert.ok(e.ctx.save.errores[campo], `esperaba error en ${campo}=${valor}`);
    }

    const tplAdmin = fs.readFileSync(path.join(__dirname, '../SistemaEduGes/Frontend/templates/componentes/modal_nuevo_usuario.html'), 'utf8');
    assert.match(tplAdmin, /id="nuevo-usuario-password"[^>]*maxlength="128"/);
    assert.match(tplAdmin, /id="nuevo-usuario-password-confirm"[^>]*maxlength="128"/);
    const tplProf = fs.readFileSync(path.join(__dirname, '../SistemaEduGes/Frontend/templates/componentes/modal_nuevo_profesional.html'), 'utf8');
    assert.doesNotMatch(tplProf, /id="nuevo-prof-password"[^>]*maxlength="128"/);
});