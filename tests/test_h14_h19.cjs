const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const leer = p => fs.readFileSync('SistemaEduGes/Frontend/static/js/' + p, 'utf8').replace(/\r/g, '');
const leerTemplate = p => fs.readFileSync('SistemaEduGes/Frontend/templates/' + p, 'utf8').replace(/\r/g, '');

const validos = ['1234567', '12345678'];
const invalidosPegado = ['123456789', '12.345.678', '12-345-678', '1234567²', '１２３４５６７８', '123A4567', ' 1234567', '1234567 '];

function entorno(inputsIniciales = []) {
    const handlers = {};
    const registroElementos = [];

    class DOMNode {
        constructor(tag = 'div', props = {}) {
            this.tagName = tag.toUpperCase();
            this.children = [];
            this.parentElement = null;
            this.dataset = {};
            this.attrs = {};
            this.hidden = false;
            this.style = {};
            this.textContent = '';
            const clases = new Set();
            this.classList = {
                add: (...c) => c.forEach(x => clases.add(x)),
                remove: (...c) => c.forEach(x => clases.delete(x)),
                contains: c => clases.has(c),
                toggle: (c, f) => (f === undefined ? (clases.has(c) ? (clases.delete(c), false) : (clases.add(c), true)) : (f ? clases.add(c) : clases.delete(c), f)),
            };
            Object.assign(this, props);
        }
        set className(v) {
            this.classList.remove(...[]);
            this._className = v;
        }
        get className() { return this._className || ''; }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        getAttribute(k) { return this.attrs[k] ?? null; }
        appendChild(nodo) {
            nodo.parentElement = this;
            this.children.push(nodo);
            return nodo;
        }
        insertAdjacentElement(pos, nodo) {
            if (pos === 'afterend') {
                this.siguienteHermano = nodo;
                nodo.parentElement = this.parentElement;
            }
            return nodo;
        }
        closest() { return null; }
        querySelector(sel) {
            return this.querySelectorAll(sel)[0] ?? null;
        }
        querySelectorAll(sel) {
            const lista = [];
            const visitar = n => {
                if (!n) return;
                if (sel === '[data-aviso-preventivo]' && Object.hasOwn(n.dataset || {}, 'avisoPreventivo')) lista.push(n);
                if (sel === '[data-contador-campo]' && Object.hasOwn(n.dataset || {}, 'contadorCampo')) lista.push(n);
                if (sel === 'input' && n instanceof Input) lista.push(n);
                for (const h of n.children || []) visitar(h);
                if (n.siguienteHermano) visitar(n.siguienteHermano);
            };
            visitar(this);
            return lista;
        }
    }

    class Input extends DOMNode {
        constructor({ value = '', name = 'dni', id = '', maxLength = 8, form = null, dataset = {} } = {}) {
            super('input', {
                value, name, id, maxLength, form,
                selectionStart: value.length,
                selectionEnd: value.length,
                error: '',
                reportes: 0,
                enfocado: 0,
                dataset: { ...dataset },
            });
            registroElementos.push(this);
        }
        setCustomValidity(x) { this.error = x; }
        reportValidity() { this.reportes++; return !this.error; }
        focus() { this.enfocado++; }
        setRangeText(texto, a, b) {
            this.value = this.value.slice(0, a) + texto + this.value.slice(b);
            this.selectionStart = this.selectionEnd = a + texto.length;
        }
        dispatchEvent(e) { emit(e.type, this, e); }
    }

    const emit = (nombre, target, extra = {}) => {
        const e = {
            target,
            cancelable: true,
            preventDefault() { this.cancelado = true; },
            stopImmediatePropagation() { this.detenido = true; },
            ...extra,
        };
        for (const fn of handlers[nombre] ?? []) fn(e);
        return e;
    };

    const creados = [];
    for (const cfg of inputsIniciales) creados.push(new Input(cfg));

    const ctx = vm.createContext({
        HTMLInputElement: Input,
        Event: class { constructor(type, options) { Object.assign(this, { type }, options); } },
        CustomEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
        queueMicrotask,
        document: {
            addEventListener: (event, fn) => (handlers[event] ??= []).push(fn),
            createElement: tag => new DOMNode(tag),
            querySelectorAll: sel => (sel === 'input' ? [...registroElementos] : []),
        },
    });

    const fuente = leer('layout.js');
    const inicio = fuente.indexOf('function prepararInputsDni(');
    const fin = fuente.indexOf('\nasync function iniciar()', inicio);
    vm.runInContext(`${fuente.slice(inicio, fin)}\nprepararInputsDni();\nprepararInputsNombreApellido();`, ctx);

    return { emit, Input, DOMNode, ctx, creados, handlers };
}

function entornoIniciarReal() {
    const handlers = {};
    const registroElementos = [];

    class DOMNode {
        constructor(tag = 'div', props = {}) {
            this.tagName = tag.toUpperCase();
            this.children = [];
            this.parentElement = null;
            this.dataset = {};
            this.attrs = {};
            this.hidden = false;
            this.style = {};
            this.textContent = '';
            const clases = new Set();
            this.classList = {
                add: (...c) => c.forEach(x => clases.add(x)),
                remove: (...c) => c.forEach(x => clases.delete(x)),
                contains: c => clases.has(c),
                toggle: (c, f) => (f === undefined ? (clases.has(c) ? (clases.delete(c), false) : (clases.add(c), true)) : (f ? clases.add(c) : clases.delete(c), f)),
            };
            Object.assign(this, props);
        }
        set className(v) { this._className = v; }
        get className() { return this._className || ''; }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        getAttribute(k) { return this.attrs[k] ?? null; }
        appendChild(nodo) { nodo.parentElement = this; this.children.push(nodo); return nodo; }
        insertAdjacentElement(pos, nodo) {
            if (pos === 'afterend') { this.siguienteHermano = nodo; nodo.parentElement = this.parentElement; }
            return nodo;
        }
        closest() { return null; }
        querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
        querySelectorAll(sel) {
            const lista = [];
            const visitar = n => {
                if (!n) return;
                if (sel === '[data-aviso-preventivo]' && Object.hasOwn(n.dataset || {}, 'avisoPreventivo')) lista.push(n);
                if (sel === '[data-contador-campo]' && Object.hasOwn(n.dataset || {}, 'contadorCampo')) lista.push(n);
                if (sel === 'input' && n instanceof Input) lista.push(n);
                for (const h of n.children || []) visitar(h);
                if (n.siguienteHermano) visitar(n.siguienteHermano);
            };
            visitar(this);
            return lista;
        }
    }

    class Input extends DOMNode {
        constructor({ value = '', name = 'dni', id = '', maxLength = 8, form = null, dataset = {} } = {}) {
            super('input', {
                value, name, id, maxLength, form,
                selectionStart: value.length,
                selectionEnd: value.length,
                error: '',
                reportes: 0,
                enfocado: 0,
                dataset: { ...dataset },
            });
            registroElementos.push(this);
        }
        setCustomValidity(x) { this.error = x; }
        reportValidity() { this.reportes++; return !this.error; }
        focus() { this.enfocado++; }
        setRangeText(texto, a, b) {
            this.value = this.value.slice(0, a) + texto + this.value.slice(b);
            this.selectionStart = this.selectionEnd = a + texto.length;
        }
        dispatchEvent(e) { emit(e.type, this, e); }
    }

    const emit = (nombre, target, extra = {}) => {
        const e = {
            target,
            cancelable: true,
            preventDefault() { this.cancelado = true; },
            stopImmediatePropagation() { this.detenido = true; },
            ...extra,
        };
        for (const fn of handlers[nombre] ?? []) fn(e);
        return e;
    };

    const sinImports = leer('layout.js')
        .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
        .replace(/\bexport\s+/g, '');

    const ctx = vm.createContext({
        HTMLInputElement: Input,
        Event: class { constructor(type, options) { Object.assign(this, { type }, options); } },
        CustomEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
        queueMicrotask,
        window: { addEventListener() {}, location: { assign() {} } },
        CONFIG: { LOGIN_URL: '/login/' },
        PERMISO: { USUARIOS_ADMIN: 'usuarios.admin' },
        ApiError: class extends Error {},
        auth: { me: async () => ({ usuario: 'test', rol: { nombre: 'Profesional' }, permisos: [] }), logout: async () => {} },
        profesionales: {},
        botonCargando() {}, html: () => '', iniciales: () => 'T', limpiarErroresFormulario() {},
        mostrarErroresFormulario: () => [], nombreCompleto: () => 'Test', notificar() {}, notificarError() {}, renderizar() {},
        inicializarModalObrasSociales() {}, prepararMostrarPassword() {}, iniciarControlDeSesion() {},
        document: {
            addEventListener: (event, fn) => (handlers[event] ??= []).push(fn),
            createElement: tag => new DOMNode(tag),
            getElementById: () => null,
            querySelectorAll: sel => (sel === 'input' ? [...registroElementos] : []),
        },
    });

    vm.runInContext(sinImports, ctx);
    return { emit, Input, DOMNode, ctx, handlers };
}

function avisoDe(campo) {
    return campo.siguienteHermano?.querySelector?.('[data-aviso-preventivo]') ?? null;
}

function contadorDe(campo) {
    return campo.siguienteHermano?.querySelector?.('[data-contador-campo]') ?? null;
}

function crearFormCon(e, id, definiciones) {
    const form = new e.DOMNode('form', { id, elements: [] });
    for (const def of definiciones) {
        const input = new e.Input({ ...def, form });
        form.elements.push(input);
        form[def.name] = input;
    }
    return form;
}

// ------------------------------------------------------------
// 1. Capitalización y preservación de nombres especiales
// ------------------------------------------------------------
test('H14: escritura y presentacion conservan nombres especiales y objeto original', () => {
    const src = leer('ui.js');
    const inicio = src.indexOf('export function capitalizar(');
    const fin = src.indexOf('export function iniciales(');
    const c = vm.createContext({});
    vm.runInContext(src.slice(inicio, fin).replace(/export /g, ''), c);
    const nombres = ['McDonald', "O'Neill", 'María José', 'Ana-María', 'DE LA CRUZ', 'Muñoz', "D'Angelo", 'Ana'];
    assert.equal(c.capitalizar('  juan   perez '), 'Juan Perez');
    assert.equal(c.capitalizar('MARÍA JOSÉ'), 'María José');
    assert.equal(c.capitalizar('gómez-lópez'), 'Gómez-López');
    assert.equal(c.capitalizar('McDonald'), 'McDonald');
    assert.equal(c.capitalizar("O'Connor"), "O'Connor");
    assert.equal([...c.capitalizar('A'.repeat(60))].length, 60);
    for (const nombre of [...nombres, 'María  José']) {
        const esperado = nombre === 'DE LA CRUZ' ? 'De La Cruz' : nombre === 'María  José' ? 'María José' : nombre;
        assert.equal(c.capitalizar(` ${nombre} `), esperado);
        const persona = { nombre, apellido: "O'Neill" };
        const previo = JSON.stringify(persona);
        assert.equal(c.nombreCompleto(persona), `${esperado} O'Neill`);
        assert.equal(JSON.stringify(persona), previo);
    }
});

// ------------------------------------------------------------
// 2. DNI — 7 y 8 dígitos válidos, letras/noveno dígito bloqueados al tipear,
//    reemplazo de selección, pegado/drop/autocompletado H19, históricos intactos
// ------------------------------------------------------------
test('Etapa1 DNI: acepta 7 y 8 digitos; rechaza letras y 9no digito al tipear con aviso inline', () => {
    for (const name of ['dni', 'tutor_dni']) {
        const e = entorno();
        const campo = new e.Input({ name, maxLength: 8 });
        e.emit('focusin', campo);

        // Escribir letra 'a': bloqueado en beforeinput, valor no cambia, aviso visible
        const evLetra = e.emit('beforeinput', campo, { data: 'a', inputType: 'insertText' });
        assert.equal(evLetra.cancelado, true);
        assert.equal(campo.value, '');
        assert.equal(avisoDe(campo).hidden, false);
        assert.match(avisoDe(campo).textContent, /0 al 9/);

        // Escribir símbolo '.': bloqueado
        const evPunto = e.emit('beforeinput', campo, { data: '.', inputType: 'insertText' });
        assert.equal(evPunto.cancelado, true);
        assert.equal(campo.value, '');

        // Escribir 7 dígitos válidos -> válido y limpia aviso
        for (const d of '1234567') {
            const ev = e.emit('beforeinput', campo, { data: d, inputType: 'insertText' });
            assert.equal(ev.cancelado, undefined);
            campo.setRangeText(d, campo.value.length, campo.value.length);
            e.emit('input', campo, { inputType: 'insertText' });
        }
        assert.equal(campo.value, '1234567');
        assert.equal(campo.error, '');
        assert.equal(avisoDe(campo).hidden, true);
        assert.equal(e.emit('submit', { elements: [campo] }).detenido, undefined);

        // Escribir 8vo dígito -> sigue válido
        const ev8 = e.emit('beforeinput', campo, { data: '8', inputType: 'insertText' });
        assert.equal(ev8.cancelado, undefined);
        campo.setRangeText('8', campo.value.length, campo.value.length);
        e.emit('input', campo, { inputType: 'insertText' });
        assert.equal(campo.value, '12345678');
        assert.equal(campo.error, '');

        // Intentar escribir 9no dígito -> bloqueado y aviso; no corrompe el DNI válido de 8 dígitos
        const ev9 = e.emit('beforeinput', campo, { data: '9', inputType: 'insertText' });
        assert.equal(ev9.cancelado, true);
        assert.equal(campo.value, '12345678');
        assert.equal(avisoDe(campo).hidden, false);
        assert.match(avisoDe(campo).textContent, /8 dígitos/);
        assert.equal(e.emit('submit', { elements: [campo] }).detenido, undefined);

        // Reemplazo de selección en campo lleno de 8 dígitos ("12345678", selecciona "5678" y tipea "9" => "12349")
        campo.selectionStart = 4;
        campo.selectionEnd = 8;
        const evReemplazo = e.emit('beforeinput', campo, { data: '9', inputType: 'insertText' });
        assert.equal(evReemplazo.cancelado, undefined);
        campo.setRangeText('9', 4, 8);
        e.emit('input', campo, { inputType: 'insertText' });
        assert.equal(campo.value, '12349');
        assert.equal(avisoDe(campo).hidden, true);

        // Borrado / flechas / composición IME no se bloquean
        assert.equal(e.emit('beforeinput', campo, { inputType: 'deleteContentBackward' }).cancelado, undefined);
        assert.equal(e.emit('beforeinput', campo, { data: 'a', isComposing: true, inputType: 'insertCompositionText' }).cancelado, undefined);
    }
});

test('Etapa1 + H19 DNI: pegado y drop invalidos se rechazan completos sin truncar ni transformar', () => {
    for (const name of ['dni', 'tutor_dni']) {
        for (const valido of validos) {
            const e = entorno();
            const campo = new e.Input({ name, maxLength: 8 });
            e.emit('focusin', campo);
            const paste = e.emit('paste', campo, { clipboardData: { getData: () => valido } });
            assert.equal(paste.cancelado, true);
            assert.equal(campo.value, valido);
            assert.equal(campo.error, '');
            assert.equal(e.emit('submit', { elements: [campo] }).detenido, undefined);
        }

        for (const invalido of [...invalidosPegado, '123\n4567']) {
            const e = entorno();
            const campo = new e.Input({ value: '', name, maxLength: 8 });
            e.emit('focusin', campo);
            const paste = e.emit('paste', campo, { clipboardData: { getData: () => invalido } });
            assert.equal(paste.cancelado, true);
            // Protección H19: nunca recorta 123456789 a 12345678 ni limpia 12.345.678
            assert.equal(campo.value, '');
            assert.ok(campo.error, invalido);
            assert.equal(avisoDe(campo).hidden, false);
            assert.equal(e.emit('submit', { elements: [campo] }).detenido, true);

            // Drop con texto inválido tampoco transforma
            const campoDrop = new e.Input({ value: '', name, maxLength: 8 });
            e.emit('focusin', campoDrop);
            const drop = e.emit('drop', campoDrop, { dataTransfer: { getData: () => invalido } });
            assert.equal(drop.cancelado, true);
            assert.equal(campoDrop.value, '');
            assert.ok(campoDrop.error);

            // Autocompletado no cancelable queda íntegro como inválido y nunca se limpia silenciosamente
            const auto = new e.Input({ value: invalido, name, maxLength: 20 });
            e.emit('input', auto, { inputType: 'insertReplacementText' });
            assert.equal(auto.value, invalido);
            assert.ok(auto.error);
            assert.equal(avisoDe(auto).hidden, false);
            assert.equal(e.emit('submit', { elements: [auto] }).detenido, true);
        }
    }
});

test('Etapa1 + H19 DNI: clipboard inaccesible rechazado; historico intacto y resolucion al corregir', async () => {
    const e = entorno();
    const campo = new e.Input({ value: 'HISTORICO', name: 'dni', maxLength: 20 });
    e.emit('focusin', campo);
    e.emit('focusout', campo);
    assert.equal(campo.error, '');
    assert.equal(avisoDe(campo)?.hidden ?? true, true);
    assert.equal(e.emit('submit', { elements: [campo] }).detenido, undefined);

    // Modificar histórico a algo inválido muestra error, pero Ctrl+Z / volver al histórico limpia
    campo.value = 'HISTORIC';
    e.emit('input', campo);
    assert.ok(campo.error);
    campo.value = 'HISTORICO';
    e.emit('input', campo);
    assert.equal(campo.error, '');
    assert.equal(avisoDe(campo).hidden, true);

    // Pegado sin clipboardData conserva valor anterior y bloquea hasta editar/corregir
    const campo2 = new e.Input({ value: '12345678', name: 'dni' });
    e.emit('focusin', campo2);
    e.emit('paste', campo2, {});
    assert.equal(campo2.value, '12345678');
    assert.ok(campo2.error);
    assert.equal(e.emit('submit', { elements: [campo2] }).detenido, true);
    e.emit('input', campo2);
    assert.equal(campo2.error, '');
    assert.equal(avisoDe(campo2).hidden, true);

    // Reapertura de modal no arrastra errores previos
    const campoModal = new e.Input({ value: '', name: 'dni', maxLength: 20 });
    e.emit('focusin', campoModal);
    campoModal.value = '123';
    e.emit('input', campoModal);
    e.emit('focusout', campoModal);
    assert.ok(campoModal.error);
    assert.equal(avisoDe(campoModal).hidden, false);
    e.emit('show.bs.modal', { querySelectorAll: () => [campoModal] });
    campoModal.value = 'LEGADO';
    await new Promise(r => queueMicrotask(r));
    assert.equal(campoModal.error, '');
    assert.equal(avisoDe(campoModal)?.hidden ?? true, true);
    assert.equal(e.emit('submit', { elements: [campoModal] }).detenido, undefined);
});

// ------------------------------------------------------------
// 3. Nombre y Apellido — Contador, 59/60/61, pegado 100 sin truncar,
//    históricos, modales repetidos y no interferencia con otros campos
// ------------------------------------------------------------
test('Etapa1 Nombre y Apellido: 59, 60 (limite alcanzado), bloqueo en 61 y pegado 100 sin truncar', () => {
    const e = entorno();
    const form = crearFormCon(e, 'form-paciente', [
        { name: 'nombre', id: 'pac-nombre', maxLength: 60 },
        { name: 'apellido', id: 'pac-apellido', maxLength: 60 },
    ]);
    const nom = form.nombre;
    e.emit('show.bs.modal', form);
    assert.equal(contadorDe(nom).textContent, '0/60');

    // 59 caracteres -> 59/60
    nom.value = 'A'.repeat(59);
    nom.selectionStart = nom.selectionEnd = 59;
    e.emit('input', nom);
    assert.equal(contadorDe(nom).textContent, '59/60');
    assert.equal(avisoDe(nom).hidden, true);

    // 60 caracteres -> 60/60 — Límite alcanzado
    const ev60 = e.emit('beforeinput', nom, { data: 'B', inputType: 'insertText' });
    assert.equal(ev60.cancelado, undefined);
    nom.setRangeText('B', 59, 59);
    e.emit('input', nom);
    assert.equal(nom.value.length, 60);
    assert.equal(contadorDe(nom).textContent, '60/60 — Límite alcanzado');

    // Intento de escribir el 61.º carácter -> bloqueado, aviso visible
    const ev61 = e.emit('beforeinput', nom, { data: 'C', inputType: 'insertText' });
    assert.equal(ev61.cancelado, true);
    assert.equal(nom.value.length, 60);
    assert.equal(avisoDe(nom).hidden, false);
    assert.match(avisoDe(nom).textContent, /60/);

    // Borrar 1 vuelve a 59/60 y quita aviso
    nom.value = 'A'.repeat(59);
    e.emit('input', nom);
    assert.equal(contadorDe(nom).textContent, '59/60');
    assert.equal(avisoDe(nom).hidden, true);

    // Pegado de 100 caracteres sobre campo vacío -> rechazado completo, sin truncar a 60
    const ape = form.apellido;
    e.emit('focusin', ape);
    const evPaste100 = e.emit('paste', ape, { clipboardData: { getData: () => 'Z'.repeat(100) } });
    assert.equal(evPaste100.cancelado, true);
    assert.equal(ape.value, '');
    assert.equal(contadorDe(ape).textContent, '0/60');
    assert.equal(avisoDe(ape).hidden, false);
    assert.match(avisoDe(ape).textContent, /100\/60/);

    // Pegado válido de nombre compuesto Unicode con apóstrofe y guion <= 60
    const evPasteOk = e.emit('paste', ape, { clipboardData: { getData: () => "María-José O'Connor Muñoz" } });
    assert.equal(evPasteOk.cancelado, true);
    assert.equal(ape.value, "María-José O'Connor Muñoz");
    assert.equal(contadorDe(ape).textContent, '25/60');
    assert.equal(avisoDe(ape).hidden, true);
});

test('Etapa1 Nombre y Apellido: historicos intactos, modales repetidos y no aplica a Obra Social/Especialidad', async () => {
    const e = entorno();
    const formEditar = crearFormCon(e, 'form-editar-paciente', [
        { name: 'nombre', id: 'edit-pac-nombre', maxLength: 60 },
        { name: 'apellido', id: 'edit-pac-apellido', maxLength: 60 },
    ]);
    const formOS = crearFormCon(e, 'form-crear-obra-social', [
        { name: 'nombre', id: 'os-nombre', maxLength: 150 },
    ]);

    // Abrir edición con apellido histórico numérico ('535345345') -> contador correcto, sin error
    e.emit('show.bs.modal', formEditar);
    formEditar.nombre.value = 'McDonald';
    formEditar.apellido.value = '535345345';
    await new Promise(r => queueMicrotask(r));
    assert.equal(contadorDe(formEditar.nombre).textContent, '8/60');
    assert.equal(contadorDe(formEditar.apellido).textContent, '9/60');
    assert.equal(avisoDe(formEditar.apellido).hidden, true);
    assert.equal(formEditar.apellido.classList.contains('is-invalid'), false);

    // Editar nombre a un carácter inválido muestra aviso; reabrir para otro paciente limpia todo
    formEditar.nombre.value = 'Juan123';
    e.emit('input', formEditar.nombre);
    assert.equal(avisoDe(formEditar.nombre).hidden, false);
    assert.equal(formEditar.nombre.classList.contains('is-invalid'), true);

    e.emit('hidden.bs.modal', formEditar);
    e.emit('show.bs.modal', formEditar);
    formEditar.nombre.value = 'Ana';
    formEditar.apellido.value = 'Gómez';
    await new Promise(r => queueMicrotask(r));
    assert.equal(avisoDe(formEditar.nombre).hidden, true);
    assert.equal(formEditar.nombre.classList.contains('is-invalid'), false);
    assert.equal(contadorDe(formEditar.nombre).textContent, '3/60');

    // Obra social (max 150) NO recibe contador ni restricción de nombres personales
    e.emit('show.bs.modal', formOS);
    await new Promise(r => queueMicrotask(r));
    assert.equal(contadorDe(formOS.nombre), null);
    formOS.nombre.value = 'OSDE 310 - Plan';
    const evOS = e.emit('beforeinput', formOS.nombre, { data: '1', inputType: 'insertText' });
    assert.equal(evOS.cancelado, undefined);
});

// ------------------------------------------------------------
// 4. Verificación de conexión con templates reales y formularios de tutores
// ------------------------------------------------------------
test('Etapa1 conexión real: templates poseen maxlength y formularios coinciden con layout.js', () => {
    const htmlChecks = [
        ['componentes/modal_paciente.html', 'form-paciente', ['pac-nombre', 'pac-apellido', 'tutor-nombre', 'tutor-apellido'], ['pac-dni', 'tutor-dni']],
        ['componentes/modal_editar_paciente.html', 'form-editar-paciente', ['edit-pac-nombre', 'edit-pac-apellido'], ['edit-pac-dni']],
        ['componentes/modal_tutor.html', 'form-agregar-tutor', ['add-tutor-nombre', 'add-tutor-apellido'], ['add-tutor-dni']],
        ['componentes/modal_tutor.html', 'form-editar-tutor', ['edit-tutor-nombre', 'edit-tutor-apellido'], []],
        ['componentes/modal_nuevo_profesional.html', 'form-nuevo-profesional', ['nuevo-prof-nombre', 'nuevo-prof-apellido'], ['nuevo-prof-dni']],
        ['profesionales.html', 'form-profesional', ['prof-nombre', 'prof-apellido'], ['prof-dni']],
    ];
    const layoutSrc = leer('layout.js');
    for (const [archivo, formId, nombresIds, dniIds] of htmlChecks) {
        const tpl = leerTemplate(archivo);
        assert.ok(tpl.includes(`id="${formId}"`), `${formId} en ${archivo}`);
        assert.ok(layoutSrc.includes(`'${formId}'`), `${formId} registrado en layout.js`);
        for (const id of nombresIds) {
            const m = tpl.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
            assert.ok(m && m[0].includes('maxlength="60"'), `${id} maxlength=60 en ${archivo}`);
        }
        for (const id of dniIds) {
            const m = tpl.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
            assert.ok(m && /name="(dni|tutor_dni)"/.test(m[0]), `${id} name dni en ${archivo}`);
        }
    }

    // Tutor combobox (#tutor-nombre / #add-tutor-nombre) permite buscar por DNI sin error en input
    const e = entorno();
    const formTutor = crearFormCon(e, 'form-paciente', [
        { name: 'tutor_nombre', id: 'tutor-nombre', maxLength: 60 },
        { name: 'tutor_apellido', id: 'tutor-apellido', maxLength: 60 },
        { name: 'tutor_dni', id: 'tutor-dni', maxLength: 8 },
    ]);
    e.emit('show.bs.modal', formTutor);
    formTutor.tutor_nombre.value = '20111222';
    e.emit('input', formTutor.tutor_nombre);
    assert.equal(avisoDe(formTutor.tutor_nombre).hidden, true);
    assert.equal(contadorDe(formTutor.tutor_nombre).textContent, '8/60');

    // Al elegir tutor existente y sincronizar, los campos y contadores se actualizan como originales intactos
    formTutor.tutor_nombre.value = 'Ana';
    formTutor.tutor_apellido.value = "O'Connor";
    formTutor.tutor_dni.value = '20111222';
    e.emit('eduges:sincronizar-campos', formTutor);
    assert.equal(contadorDe(formTutor.tutor_nombre).textContent, '3/60');
    assert.equal(contadorDe(formTutor.tutor_apellido).textContent, '8/60');
    assert.equal(avisoDe(formTutor.tutor_dni)?.hidden ?? true, true);
});

// ------------------------------------------------------------
// 5. Inicialización real de producción (iniciar()) — listeners únicos, pegado real,
//    transición de modales, históricos y preservación tras capitalización
// ------------------------------------------------------------
test('Etapa1 iniciar() real: registra listeners una sola vez y ejecuta pegado sin duplicar', async () => {
    const e = entornoIniciarReal();
    await new Promise(r => setImmediate(r));

    // Confirmar exactamente 1 registro de paste/beforeinput/drop para DNI y 1 para Nombre/Apellido
    assert.equal(e.handlers.paste.length, 2);
    assert.equal(e.handlers.beforeinput.length, 2);
    assert.equal(e.handlers.drop.length, 2);

    const form = crearFormCon(e, 'form-paciente', [
        { name: 'nombre', id: 'pac-nombre', maxLength: 60 },
        { name: 'apellido', id: 'pac-apellido', maxLength: 60 },
        { name: 'dni', id: 'pac-dni', maxLength: 8 },
    ]);
    e.emit('show.bs.modal', form);
    await new Promise(r => queueMicrotask(r));

    // Pegar 'Juan' -> 'Juan', nunca 'JuanJuan'
    const nom = form.nombre;
    e.emit('focusin', nom);
    e.emit('paste', nom, { clipboardData: { getData: () => 'Juan' } });
    assert.equal(nom.value, 'Juan');
    assert.equal(contadorDe(nom).textContent, '4/60');

    // Pegar 31 caracteres válidos -> exactamente 31
    nom.value = '';
    nom.selectionStart = nom.selectionEnd = 0;
    e.emit('input', nom);
    e.emit('paste', nom, { clipboardData: { getData: () => 'A'.repeat(31) } });
    assert.equal(nom.value.length, 31);
    assert.equal(contadorDe(nom).textContent, '31/60');

    // Pegar 60 caracteres válidos -> exactamente 60 y límite alcanzado
    nom.value = '';
    nom.selectionStart = nom.selectionEnd = 0;
    e.emit('input', nom);
    e.emit('paste', nom, { clipboardData: { getData: () => 'M'.repeat(60) } });
    assert.equal(nom.value.length, 60);
    assert.equal(contadorDe(nom).textContent, '60/60 — Límite alcanzado');
    assert.equal(avisoDe(nom).hidden, true);

    // Reemplazar selección dentro de campo lleno de 60 ('M'.repeat(60), sel 50..60 -> 'N'.repeat(10))
    nom.selectionStart = 50;
    nom.selectionEnd = 60;
    e.emit('paste', nom, { clipboardData: { getData: () => 'N'.repeat(10) } });
    assert.equal(nom.value, 'M'.repeat(50) + 'N'.repeat(10));
    assert.equal(nom.value.length, 60);
    assert.equal(avisoDe(nom).hidden, true);

    // Pegar 61 y 100 caracteres sobre vacío -> rechazados completos con aviso
    for (const largo of [61, 100]) {
        nom.value = '';
        nom.selectionStart = nom.selectionEnd = 0;
        e.emit('input', nom);
        e.emit('paste', nom, { clipboardData: { getData: () => 'X'.repeat(largo) } });
        assert.equal(nom.value, '');
        assert.equal(avisoDe(nom).hidden, false);
        assert.match(avisoDe(nom).textContent, new RegExp(`${largo}/60`));
    }

    // DNI a través de iniciar() real: bloquea letras y 9.º dígito, acepta pegado válido y rechaza 9 dígitos
    const dni = form.dni;
    e.emit('focusin', dni);
    assert.equal(e.emit('beforeinput', dni, { data: 'x', inputType: 'insertText' }).cancelado, true);
    e.emit('paste', dni, { clipboardData: { getData: () => '123456789' } });
    assert.equal(dni.value, '');
    assert.ok(dni.error);
    e.emit('paste', dni, { clipboardData: { getData: () => '12345678' } });
    assert.equal(dni.value, '12345678');
    assert.equal(dni.error, '');
    assert.equal(e.emit('beforeinput', dni, { data: '9', inputType: 'insertText' }).cancelado, true);
    assert.equal(dni.value, '12345678');
});

test('Etapa1 iniciar() real: historicos, transicion modal, re-enfoque tras capitalizar y cambio de registro', async () => {
    const e = entornoIniciarReal();
    await new Promise(r => setImmediate(r));

    const uiSrc = leer('ui.js');
    const capIni = uiSrc.indexOf('export function capitalizar(');
    const capFin = uiSrc.indexOf('export function iniciales(');
    vm.runInContext(uiSrc.slice(capIni, capFin).replace(/export /g, ''), e.ctx);

    const form = crearFormCon(e, 'form-editar-paciente', [
        { name: 'nombre', id: 'edit-pac-nombre', maxLength: 60 },
        { name: 'apellido', id: 'edit-pac-apellido', maxLength: 60 },
        { name: 'dni', id: 'edit-pac-dni', maxLength: 20 },
    ]);

    // 1. Abrir formulario con datos históricos no conformes
    e.emit('show.bs.modal', form);
    form.nombre.value = '535345345';
    form.apellido.value = 'Muñoz';
    form.dni.value = 'HISTORICO';
    await new Promise(r => queueMicrotask(r));

    // Enfocar y salir sin editar
    e.emit('focusin', form.nombre);
    e.emit('focusout', form.nombre);
    e.emit('focusin', form.dni);
    e.emit('focusout', form.dni);
    assert.equal(form.dni.error, '');
    assert.equal(avisoDe(form.nombre).hidden, true);

    // 2. Simular edición temprana durante la transición (y luego disparo tardío de shown.bs.modal)
    form.dni.value = '123';
    e.emit('input', form.dni);
    e.emit('shown.bs.modal', form);
    assert.equal(e.emit('submit', form).detenido, true, 'shown.bs.modal no debe sobrescribir original tras edición');

    // Revertir al histórico conserva intacto y desbloquea
    form.dni.value = 'HISTORICO';
    e.emit('input', form.dni);
    assert.equal(form.dni.error, '');
    assert.equal(e.emit('submit', form).detenido, undefined);

    // 3. Editar nombre, capitalizar en blur, salir y volver a enfocar -> original ('535345345') NO se pierde
    e.emit('focusin', form.nombre);
    form.nombre.value = '  ana   maria ';
    e.emit('input', form.nombre);
    form.nombre.value = e.ctx.capitalizar(form.nombre.value);
    e.emit('focusout', form.nombre);
    e.emit('focusin', form.nombre);
    form.nombre.value = '535345345';
    e.emit('input', form.nombre);
    assert.equal(avisoDe(form.nombre).hidden, true);
    assert.equal(form.nombre.classList.contains('is-invalid'), false);

    // 4. Cerrar y abrir otro registro con error previo -> limpia avisos anteriores y carga nuevo original
    form.dni.value = '123';
    e.emit('input', form.dni);
    e.emit('focusout', form.dni);
    assert.ok(form.dni.error);
    e.emit('hidden.bs.modal', form);
    e.emit('show.bs.modal', form);
    form.nombre.value = 'Lucas';
    form.apellido.value = 'Pérez';
    form.dni.value = '30111222';
    await new Promise(r => queueMicrotask(r));
    assert.equal(form.dni.error, '');
    assert.equal(avisoDe(form.dni)?.hidden ?? true, true);
    assert.equal(contadorDe(form.nombre).textContent, '5/60');
});

test('H14 H19: tutor adicional conserva nombres y edicion ajena los omite', () => {
    const src = leer('paginas/pacientes.js'), ui = leer('ui.js');
    const campos = {
        nombre: { value: 'McDonald' }, apellido: { value: "O'Neill" }, dni: { value: '12345678' },
        parentesco_id: { value: '1' }, telefono: { value: '123' }, movil: { value: '' },
        mail: { value: 'ficticio@example.com', checkValidity: () => true }, domicilio: { value: 'Ficticio' }, tutor_id: { value: '1' },
    };
    const form = { elements: campos, addEventListener: (n, f) => { c.submit = f; } };
    const c = vm.createContext({
        formAgregar: form, formEditar: form, estado: { fichaId: 1 },
        guardar: opts => { c.guardado = opts; },
        tutores: { crear: datos => { c.enviado = datos; }, actualizar: (id, datos) => { c.enviado = datos; } },
        $: () => ({ checked: false }), erroresAgregar: {}, erroresEditar: {}, modalAgregar() {}, modalEditar() {},
        cargarTutoresFicha() {}, errorDomicilio: () => null, mailTutorOriginal: 'ficticio@example.com',
        domicilioTutorOriginal: 'Ficticio', nombresTutorOriginales: { nombre: 'McDonald', apellido: "O'Neill" },
        validarNombrePersonal: valor => (valor && String(valor).length <= 60 ? null : 'El nombre no puede superar los 60 caracteres.'),
    });
    const inicio = ui.indexOf('export function capitalizar(');
    vm.runInContext(ui.slice(inicio, ui.indexOf('\n}', inicio) + 2).replace('export ', ''), c);
    for (const tipo of ['Agregar', 'Editar']) {
        const a = src.indexOf(`form${tipo}.addEventListener('submit'`);
        vm.runInContext(src.slice(a, src.indexOf('\n    });', a) + 8), c);
        c.submit({ preventDefault() {} }); c.guardado.enviar();
        if (tipo === 'Agregar') {
            assert.equal(c.enviado.nombre, 'McDonald'); assert.equal(c.enviado.apellido, "O'Neill");
            campos.dni.value = ' 1234567'; c.submit({ preventDefault() {} }); assert.ok(c.guardado.errores.dni);
        } else {
            assert.equal(c.enviado.nombre, undefined); assert.equal(c.enviado.apellido, undefined);
            campos.nombre.value = 'DE LA CRUZ'; c.submit({ preventDefault() {} }); c.guardado.enviar();
            assert.equal(c.enviado.nombre, 'De La Cruz');
        }
    }
});
