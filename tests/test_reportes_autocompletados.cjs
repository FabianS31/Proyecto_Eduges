// Ejecutar: node --test tests/test_reportes_autocompletados.cjs
// Código real con DOM y API ficticios; no realiza conexiones de red.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const base = path.join(__dirname, '../SistemaEduGes/Frontend/static/js');
const leer = (archivo) => fs.readFileSync(path.join(base, archivo), 'utf8');
const sinImports = (fuente) => fuente.replace(/^import[\s\S]*?;\s*$/gm, '').replace(/\bexport /g, '');
const diferida = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

function entorno() {
    const nodos = new Map();
    function crear(id = '') {
        const clases = new Set();
        return {
            id, value: '', textContent: '', innerHTML: '', disabled: false,
            dataset: {}, style: {}, hidden: false, children: [], eventos: {},
            options: [{ text: 'Todos' }], selectedIndex: 0,
            classList: {
                add: (...items) => items.forEach((x) => clases.add(x)),
                remove: (...items) => items.forEach((x) => clases.delete(x)),
                contains: (x) => clases.has(x),
                toggle: (x, on) => on ? clases.add(x) : clases.delete(x),
            },
            addEventListener(nombre, fn) { (this.eventos[nombre] ??= []).push(fn); },
            async emitir(nombre, evento = {}) {
                for (const fn of this.eventos[nombre] || []) await fn({ target: this, preventDefault() {}, ...evento });
            },
            setAttribute(nombre, valor) { this[nombre] = valor; },
            removeAttribute(nombre) { delete this[nombre]; },
            append(...hijos) { this.children.push(...hijos); },
            appendChild(hijo) { this.children.push(hijo); },
            replaceWith(padre) { this.parent = padre; },
            querySelectorAll() { return []; },
            click() {}, remove() {}, reset() {},
        };
    }
    const nodo = (id) => {
        if (!nodos.has(id)) nodos.set(id, crear(id));
        return nodos.get(id);
    };
    const radios = ['turnos', 'pacientes', 'profesionales'].map((tipo) => {
        const radio = nodo(`tab-${tipo}`); radio.value = tipo; return radio;
    });
    const contexto = {
        console: { warn() {}, error() {} }, AbortController,
        document: {
            getElementById: nodo, createElement: () => crear(),
            querySelector: () => null,
            querySelectorAll: (selector) => selector.includes('tipo_reporte') ? radios : [],
            addEventListener() {}, body: crear(), activeElement: null,
        },
        window: { addEventListener() {}, print() { contexto.impresiones++; } },
        impresiones: 0, descargas: [], avisos: [],
        Blob: class { constructor(partes) { contexto.descargas.push(partes.join('')); } },
        URL: { createObjectURL: () => 'blob:ficticio', revokeObjectURL() {} },
        pacientes: { listar: async () => [] }, profesionales: { listar: async () => [] },
        tutores: { listar: async () => [] },
        reportes: Object.fromEntries(['turnos', 'pacientes', 'profesionales'].map((tipo) => [tipo, async () => ({ total: 0, resultados: [] })])),
        crearCombobox: () => ({ limpiar() {} }),
        buscarEnLista: (opciones) => async (texto) => opciones.filter((p) => p.texto.toLowerCase().includes(texto.toLowerCase())),
        coincideBusqueda: (campos, texto) => campos.join(' ').toLowerCase().includes(texto.toLowerCase()),
        normalizarTexto: (texto) => texto.toLowerCase(),
        html: (partes, ...valores) => partes.reduce((s, p, i) => s + p + (valores[i] ?? ''), ''),
        renderizar: (el, contenido) => { el.innerHTML = String(contenido); },
        botonCargando: (el, on) => { el.disabled = on; },
        bloqueCargando: () => 'CARGANDO', bloqueError: (m) => `ERROR: ${m}`,
        bloqueVacio: (m) => `VACIO: ${m}`, icono: () => '',
        notificar: (m) => contexto.avisos.push(m), notificarError: (e) => contexto.avisos.push(e.message),
        mensajeDeError: (e) => e.message, demorar: (fn) => fn,
        edad: () => 10, estadoCud: () => 'vigente', badgeCud: () => '',
        enlaceMail: (v) => v || '', enlaceTelefono: (v) => v || '',
        formatearFecha: (v) => v || '', nombreCompleto: () => 'Persona ficticia',
        hoyISO: () => '2026-11-10',
    };
    vm.createContext(contexto);
    return { c: contexto, nodo, ejecutar: (s) => vm.runInContext(s, contexto) };
}

function reportesEntorno() {
    const e = entorno();
    e.ejecutar(sinImports(leer('paginas/reportes.js')));
    e.ejecutar('globalThis.estadoPrueba = estado; conectarEventos(); invalidarReporte();');
    return e;
}

const turno = (id) => ({ id, fecha: '2026-11-10', hora: '09:00', paciente: { nombre: 'Ana', apellido: 'Ficticia' }, profesional: { nombre: 'Luis', apellido: 'Prueba' }, estado: { id: 1, nombre: 'Pendiente' } });
function sinResultados(e) {
    assert.equal(e.c.estadoPrueba.resultados.length, 0);
    assert.equal(e.c.estadoPrueba.resultadosVigentes, false);
    assert.equal(e.nodo('btn-exportar-csv').disabled, true);
    assert.equal(e.nodo('btn-imprimir').disabled, true);
    assert.equal(e.nodo('reporte-cuerpo').innerHTML, '');
    assert.equal(e.nodo('reporte-kpis').innerHTML, '');
    assert.equal(e.nodo('reporte-tabla-contenedor').classList.contains('d-none'), true);
    assert.equal(e.c.estadoPrueba.cargando, false);
    assert.equal(e.nodo('btn-aplicar-filtros').disabled, false);
}

test('H4: éxito conserva resultados, filtros, CSV e impresión', async () => {
    const e = reportesEntorno();
    let filtros;
    e.c.reportes.turnos = async (params) => { filtros = params; return { total: 1, resultados: [turno(1)] }; };
    e.nodo('filtro-turno-desde').value = '2026-11-01';
    e.nodo('filtro-turno-estado').value = '1';
    await e.c.consultarReporte();
    assert.deepEqual(JSON.parse(JSON.stringify(filtros)), { fecha_desde: '2026-11-01', estado_id: 1 });
    assert.equal(e.c.estadoPrueba.resultados[0].id, 1);
    assert.equal(e.nodo('reporte-tabla-contenedor').classList.contains('d-none'), false);
    assert.equal(e.nodo('btn-exportar-csv').disabled, false);
    await e.nodo('btn-exportar-csv').emitir('click');
    await e.nodo('btn-imprimir').emitir('click');
    assert.equal(e.c.descargas.length, 1);
    assert.match(e.c.descargas[0], /Ficticia/);
    assert.equal(e.c.impresiones, 1);
});

for (const tipo of ['turnos', 'pacientes']) {
    test(`H4: rango inválido de ${tipo} limpia datos y no consulta`, async () => {
        const e = reportesEntorno();
        e.c.reportes.turnos = async () => ({ total: 1, resultados: [turno(1)] });
        await e.c.consultarReporte();
        e.c.estadoPrueba.tipo = tipo;
        const prefijo = tipo === 'turnos' ? 'filtro-turno' : 'filtro-paciente-alta';
        e.nodo(`${prefijo}-desde`).value = '2026-11-20';
        e.nodo(`${prefijo}-hasta`).value = '2026-11-01';
        e.c.reportes[tipo] = async () => { assert.fail('No debe consultar'); };
        await e.c.consultarReporte();
        sinResultados(e);
        assert.match(e.nodo('reporte-estado').innerHTML, /ERROR.*Desde/);
        await e.nodo('btn-exportar-csv').emitir('click');
        await e.nodo('btn-imprimir').emitir('click');
        assert.equal(e.c.descargas.length, 0);
        assert.equal(e.c.impresiones, 0);
    });
}

for (const tipo of ['turnos', 'pacientes', 'profesionales']) {
    test(`H4: error y recuperación de ${tipo}, incluyendo vacío válido`, async () => {
        const e = reportesEntorno();
        e.c.reportes.turnos = async () => ({ total: 1, resultados: [turno(1)] });
        await e.c.consultarReporte();
        e.c.estadoPrueba.tipo = tipo;
        e.c.reportes[tipo] = async () => { throw new Error('Sin conexión'); };
        await e.c.consultarReporte();
        sinResultados(e);
        assert.match(e.nodo('reporte-estado').innerHTML, /ERROR/);
        e.c.reportes[tipo] = async () => ({ total: 0, resultados: [] });
        await e.c.consultarReporte();
        assert.equal(e.c.estadoPrueba.resultadosVigentes, true);
        assert.equal(e.c.estadoPrueba.cargando, false);
        assert.match(e.nodo('reporte-estado').innerHTML, /VACIO/);
        await e.nodo('btn-exportar-csv').emitir('click');
        assert.equal(e.c.descargas.length, 0);
    });
}

test('H4: cambiar filtros invalida la respuesta que todavía está en vuelo', async () => {
    const e = reportesEntorno();
    const pendiente = diferida();
    e.c.reportes.turnos = () => pendiente.promise;
    const consulta = e.c.consultarReporte();
    assert.equal(e.nodo('btn-exportar-csv').disabled, true);
    await e.nodo('filtros-reporte').emitir('input');
    pendiente.resolve({ total: 1, resultados: [turno(1)] });
    await consulta;
    sinResultados(e);
    assert.match(e.nodo('reporte-estado').innerHTML, /Aplicá/);
});

for (const falla of [false, true]) {
    test(`H4: respuesta anterior ${falla ? 'fallida' : 'exitosa'} no pisa una consulta nueva`, async () => {
        const e = reportesEntorno();
        const vieja = diferida();
        e.c.reportes.turnos = () => vieja.promise;
        const anterior = e.c.consultarReporte();
        e.c.reportes.profesionales = async () => ({ total: 1, resultados: [{ id: 9, nombre: 'Nuevo', apellido: 'Ficticio' }] });
        await e.nodo('tab-profesionales').emitir('change');
        if (falla) vieja.reject(new Error('Fallo viejo'));
        else vieja.resolve({ total: 1, resultados: [turno(1)] });
        await anterior;
        assert.equal(e.c.estadoPrueba.tipo, 'profesionales');
        assert.equal(e.c.estadoPrueba.resultados[0].id, 9);
        assert.equal(e.c.estadoPrueba.resultadosVigentes, true);
        assert.equal(e.nodo('btn-exportar-csv').disabled, false);
    });
}

const proveedores = [
    ['pacientes en reportes', 'pacientes', 'sugerirPacientes', () => sinImports(leer('paginas/reportes.js'))],
    ['profesionales en reportes', 'profesionales', 'sugerirProfesionales', () => sinImports(leer('paginas/reportes.js'))],
    ['tutores en alta', 'tutores', 'sugerirTutores', () => sinImports(leer('componentes/formulario-paciente.js'))],
    ['tutores en ficha', 'tutores', 'sugerirTutoresAgregar', () => {
        const s = leer('paginas/pacientes.js');
        const inicio = s.indexOf('    let tutoresDisponibles', s.indexOf('function prepararGestionTutores'));
        return 'const estado = { fichaId: 100 };\n' + s.slice(inicio, s.indexOf('    const comboboxAddTutor', inicio));
    }],
    ['tutores en turnos', 'tutores', 'sugerirTutoresConPacientes', () => {
        const s = leer('componentes/turnos.js');
        const inicio = s.indexOf('async function sugerirTutoresConPacientes');
        return s.slice(inicio, s.indexOf('// Horarios', inicio));
    }],
];

for (const [nombre, api, funcion, fuente] of proveedores) {
    function preparar() {
        const e = entorno();
        e.c.$ = e.nodo;
        e.ejecutar(fuente());
        return e;
    }
    test(`H6: ${nombre} propaga error y reintenta la siguiente búsqueda`, async () => {
        const e = preparar();
        let llamadas = 0;
        e.c[api].listar = async () => {
            llamadas++;
            if (llamadas === 1) throw new Error('Sin conexión');
            return [{ id: 1, id_paciente: 1, id_profesional: 1, nombre: 'Ana', apellido: 'Ficticia' }];
        };
        await assert.rejects(e.c[funcion]('Ana'), /Sin conexión/);
        const opciones = await e.c[funcion]('Ana');
        assert.equal(opciones.length, 1);
        assert.equal(llamadas, 2);
    });
    test(`H6: ${nombre} acepta vacío válido sin mostrar error`, async () => {
        const e = preparar();
        let llamadas = 0;
        e.c[api].listar = async () => { llamadas++; return []; };
        assert.equal((await e.c[funcion]('Ana')).length, 0);
        assert.equal((await e.c[funcion]('Ana')).length, 0);
        assert.equal(llamadas, nombre === 'tutores en turnos' ? 2 : 1);
    });
}

test('H6: combobox distingue error de vacío y no permite elegir opciones anteriores', async () => {
    const e = entorno();
    e.ejecutar(sinImports(leer('componentes/combobox.js')));
    const input = e.nodo('busqueda');
    e.c.document.activeElement = input;
    let modo = 'exito', elegidas = 0;
    e.c.crearCombobox(input, {
        buscar: async () => {
            if (modo === 'error') throw new Error('Sin conexión');
            return modo === 'vacio' ? [] : [{ valor: 1, texto: 'Ana' }];
        },
        mensajeVacio: 'Sin coincidencias', alElegir: () => elegidas++,
    });
    const lista = input.parent.children[1];
    await input.emitir('keydown', { key: 'ArrowDown' });
    await new Promise(setImmediate);
    modo = 'error';
    await input.emitir('input');
    await new Promise(setImmediate);
    assert.match(lista.innerHTML, /Sin conexión/);
    await input.emitir('keydown', { key: 'Enter' });
    assert.equal(elegidas, 0);
    modo = 'vacio';
    await input.emitir('input');
    await new Promise(setImmediate);
    assert.match(lista.innerHTML, /Sin coincidencias/);
    modo = 'exito';
    await input.emitir('input');
    await new Promise(setImmediate);
    assert.match(lista.innerHTML, /Ana/);
});
