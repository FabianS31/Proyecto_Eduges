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

test('Profesional: pacientes autorizados en pestaña, filtros, indicadores, CSV e impresión', async () => {
    const e = reportesEntorno();
    e.c.estadoPrueba.esPro = true;
    e.c.estadoPrueba.usuario = { rol: { nombre: 'Profesional' } };
    e.c.configurarPermisosYRoles();
    assert.equal(e.nodo('tab-pacientes').hidden, false);
    assert.equal(e.nodo('tab-profesionales').hidden, true);
    e.c.estadoPrueba.tipo = 'pacientes';
    e.c.pacientes.listar = async () => { throw new Error('No usar listado auxiliar'); };
    const filas = [
        { id: 1, nombre: 'Activa', apellido: 'Propia', estado: { id: 1, nombre: 'Activo' },
          obra_social: { id: 8, nombre: 'Obra A' }, profesionales_asignados: [{ id: 1, nombre: 'Luis', apellido: 'Prueba' }] },
        { id: 2, nombre: 'Inactiva', apellido: 'Propia', estado: { id: 2, nombre: 'Inactivo' },
          obra_social: { id: 9, nombre: 'Obra B' }, profesionales_asignados: [] },
    ];
    e.c.reportes.pacientes = async (f = {}) => {
        const resultados = filas.filter(p => (!f.estado_id || p.estado.id === f.estado_id)
            && (!f.obra_social_id || p.obra_social.id === f.obra_social_id));
        return { total: resultados.length, resultados };
    };
    await e.c.consultarReporte();
    assert.equal(e.c.estadoPrueba.resultados.length, 2);
    assert.match(e.nodo('reporte-kpis').innerHTML, /eg-stat__value">2<\/span>/);
    assert.equal((e.nodo('reporte-kpis').innerHTML.match(/eg-stat__value">1<\/span>/g) || []).length, 2);
    assert.match(e.nodo('reporte-cuerpo').innerHTML, /Prueba, Luis/);
    assert.match(e.nodo('reporte-cuerpo').innerHTML, /Sin asignación vigente/);
    const sugerencias = await e.c.sugerirPacientes('Inactiva');
    assert.equal(sugerencias[0].valor, 2);
    e.nodo('filtro-paciente-estado').value = '2';
    e.nodo('filtro-paciente-obra-social').value = '9';
    await e.c.consultarReporte();
    assert.equal(e.nodo('reporte-total').textContent, '1 registro');
    assert.doesNotMatch(e.nodo('reporte-cuerpo').innerHTML, />Activa/);
    await e.nodo('btn-exportar-csv').emitir('click');
    assert.equal(e.c.descargas[0].split('\r\n').length, 2);
    assert.match(e.c.descargas[0], /Inactiva/);
    assert.doesNotMatch(e.c.descargas[0], /"Activa"|diagnostico|nota_sesion/);
    await e.nodo('btn-imprimir').emitir('click');
    assert.equal(e.c.impresiones, 1);
    assert.match(e.nodo('print-reporte-titulo').textContent, /Mis Pacientes Autorizados/);
    e.c.reportes.pacientes = async () => { throw new Error('Fallo controlado'); };
    await e.c.consultarReporte();
    sinResultados(e);
    assert.equal(e.c.asignacionesPaciente({}), 'Asignación no disponible');
});

test('Profesional carga obras sociales y tutores para pacientes sin catálogo de profesionales', async () => {
    const e = reportesEntorno();
    e.c.estadoPrueba.esPro = true;
    e.c.catalogos = { obrasSociales: async () => [{ id: 8, nombre: 'Obra ficticia' }] };
    e.c.tutores.listar = async () => [{ id: 7, nombre: 'Tutor autorizado' }];
    e.c.profesionales.listar = async () => { assert.fail('No corresponde'); };
    await e.c.cargarCatalogos();
    assert.match(e.nodo('filtro-paciente-obra-social').innerHTML, /Obra ficticia/);
    assert.match(e.nodo('filtro-paciente-tutor').innerHTML, /Tutor autorizado/);
});

for (const esPro of [true, false]) {
    test(`H03: tabla, totales, indicadores, CSV e impresion usan respuesta autorizada (${esPro ? 'Profesional' : 'Administrador'})`, async () => {
        const e = reportesEntorno();
        e.c.estadoPrueba.esPro = esPro;
        e.c.estadoPrueba.usuario = { rol: { nombre: esPro ? 'Profesional' : 'Administrador' } };
        const propio = { ...turno(101), trabajo_sesion: 'Trabajo propio', nota_sesion: 'Nota privada' };
        const anterior = { ...turno(202), profesional: { nombre: 'Anterior', apellido: 'Otro' } };
        const autorizados = esPro ? [propio] : [turno(101), anterior];
        e.c.reportes.turnos = async () => ({ total: autorizados.length, resultados: autorizados });
        await e.c.consultarReporte();
        assert.equal(e.c.estadoPrueba.resultados.length, autorizados.length);
        assert.equal(e.nodo('reporte-total').textContent, `${autorizados.length} ${esPro ? 'registro' : 'registros'}`);
        assert.match(e.nodo('reporte-kpis').innerHTML, new RegExp(`eg-stat__value">${autorizados.length}</span>`));
        const tabla = e.nodo('reporte-cuerpo').innerHTML;
        if (esPro) assert.doesNotMatch(tabla, /Anterior/);
        else assert.match(tabla, /Anterior/);
        await e.nodo('btn-exportar-csv').emitir('click');
        assert.equal(e.c.descargas[0].split('\r\n').length, autorizados.length + 1);
        assert.doesNotMatch(e.c.descargas[0], /Nota privada/);
        if (esPro) assert.doesNotMatch(e.c.descargas[0], /Anterior/);
        else assert.doesNotMatch(e.c.descargas[0], /Trabajo propio|Nota privada/);
        await e.nodo('btn-imprimir').emitir('click');
        assert.equal(e.c.impresiones, 1);
        assert.equal(e.nodo('reporte-cuerpo').innerHTML, tabla);
    });
}

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

for (const [tipo, campo, combo, parametro] of [
    ['turnos', 'filtro-turno-busqueda', 'turnos', 'paciente_id'],
    ['pacientes', 'filtro-paciente-q', 'pacientes', 'paciente_id'],
    ['profesionales', 'filtro-profesional-q', 'profesionales', 'profesional_id'],
]) {
    test(`Selección exacta, edición, limpieza y exportación: ${tipo}`, async () => {
        const e = entorno();
        e.ejecutar(sinImports(leer('componentes/combobox.js')));
        e.ejecutar(sinImports(leer('paginas/reportes.js')));
        e.ejecutar('globalThis.estadoPrueba = estado; globalThis.combosPrueba = combos; conectarEventos();');
        e.c.estadoPrueba.tipo = tipo;
        const filas = [1, 2].map(id => tipo === 'turnos' ? turno(id) :
            { id, nombre: 'Ana', apellido: 'Ficticia', dni: `SINTETICO-${id}` });
        let parametros;
        e.c.reportes[tipo] = async params => {
            parametros = params;
            const resultados = params[parametro] ? filas.filter(f => f.id === params[parametro]) : filas;
            return { total: resultados.length, resultados };
        };
        e.c.combosPrueba[combo].elegir({ valor: 2, texto: 'Ficticia, Ana' });
        await new Promise(setImmediate);
        assert.equal(parametros[parametro], 2);
        assert.equal(e.c.estadoPrueba.resultados.length, 1);
        assert.equal(e.c.estadoPrueba.resultados[0].id, 2);
        await e.nodo('btn-exportar-csv').emitir('click');
        assert.equal(e.c.descargas[0].split('\r\n').length, 2);
        await e.nodo('btn-imprimir').emitir('click');
        assert.match(e.nodo('print-criterios').textContent, /ID 2/);
        assert.match(e.nodo('print-criterios').textContent, /Total: 1/);
        e.nodo(campo).value = 'Ana';
        await e.nodo(campo).emitir('input');
        assert.equal(e.nodo(campo).dataset.valor, '');
        assert.equal(e.c.estadoPrueba.resultadosVigentes, false);
        await e.c.consultarReporte();
        assert.equal(parametros[parametro], undefined);
        assert.equal(e.c.estadoPrueba.resultados.length, 2);
        e.c.combosPrueba[combo].elegir({ valor: 1, texto: 'Ficticia, Ana' });
        await new Promise(setImmediate);
        await e.nodo('btn-limpiar-filtros').emitir('click');
        assert.equal(e.nodo(campo).value, '');
        assert.equal(e.nodo(campo).dataset.valor, '');
        assert.equal(parametros[parametro], undefined);
        assert.equal(e.c.estadoPrueba.resultados.length, 2);
    });
}

test('Catálogos: tres especialidades, error visible, reintento y selección conservada', async () => {
    const e = reportesEntorno();
    let falla = true;
    e.c.catalogos = {
        obrasSociales: async () => [],
        especialidades: async () => {
            if (falla) throw new Error('Fallo sintético');
            return [{ id: 7, nombre: 'Especialidad A' }, { id: 8, nombre: 'Especialidad B' }, { id: 9, nombre: 'Especialidad C' }];
        },
    };
    e.nodo('filtro-turno-profesional').value = '42';
    await e.c.cargarCatalogos();
    assert.equal(e.nodo('reportes-catalogos-error').hidden, false);
    assert.match(e.nodo('reportes-catalogos-mensaje').textContent, /especialidades/);
    falla = false;
    await e.nodo('btn-reintentar-catalogos').emitir('click');
    assert.equal(e.nodo('reportes-catalogos-error').hidden, true);
    for (const id of [7, 8, 9]) assert.match(e.nodo('filtro-profesional-especialidad').innerHTML, new RegExp(`value="${id}"`));
    assert.equal(e.nodo('filtro-turno-profesional').value, '42');
    e.c.estadoPrueba.tipo = 'profesionales';
    e.nodo('filtro-profesional-especialidad').value = '8';
    e.c.reportes.profesionales = async params => {
        assert.equal(params.especialidad_id, 8);
        return { total: 0, resultados: [] };
    };
    await e.c.consultarReporte();
});

test('Impresión refleja inactivos, fechas de alta y búsqueda', async () => {
    const e = reportesEntorno();
    e.c.estadoPrueba.tipo = 'pacientes';
    e.nodo('filtro-paciente-estado').value = '2';
    e.nodo('filtro-paciente-estado').options = [{ text: 'Inactivo' }];
    e.nodo('filtro-paciente-alta-desde').value = '2026-01-01';
    e.nodo('filtro-paciente-alta-hasta').value = '2026-11-01';
    e.nodo('filtro-paciente-q').value = 'Ana';
    await e.c.consultarReporte();
    assert.match(e.nodo('print-periodo').textContent, /2026-01-01.*2026-11-01/);
    assert.match(e.nodo('print-criterios').textContent, /Inactivo.*Búsqueda: Ana/);
    assert.doesNotMatch(e.nodo('print-periodo').textContent, /Padrón activo/);
    e.c.estadoPrueba.tipo = 'profesionales';
    e.nodo('filtro-profesional-estado').value = '2';
    e.nodo('filtro-profesional-estado').options = [{ text: 'Inactivo' }];
    await e.c.consultarReporte();
    assert.match(e.nodo('print-criterios').textContent, /Inactivo/);
    assert.doesNotMatch(e.nodo('print-periodo').textContent, /Nómina activa/);
});

test('Trabajo de sesión usa respuesta del servidor y respeta Administrador', async () => {
    const e = reportesEntorno();
    e.c.estadoPrueba.usuario = { rol: { nombre: 'Profesional' } };
    e.c.estadoPrueba.esPro = true;
    e.nodo('filtro-turno-trabajo').value = 'ATENCION, memoria';
    e.c.reportes.turnos = async params => {
        assert.equal(params.trabajo_sesion, 'ATENCION, memoria');
        return { total: 1, resultados: [{ ...turno(1), trabajo_sesion: 'Memoria y atención sostenida' }] };
    };
    await e.c.consultarReporte();
    assert.equal(e.c.estadoPrueba.resultados.length, 1);
    assert.match(e.nodo('print-criterios').textContent, /Trabajo de Sesión: ATENCION, memoria/);
    e.c.estadoPrueba.usuario.rol.nombre = 'Administrador';
    e.c.reportes.turnos = async params => {
        assert.equal(params.trabajo_sesion, undefined);
        return { total: 0, resultados: [] };
    };
    await e.c.consultarReporte();
    assert.doesNotMatch(e.nodo('print-criterios').textContent, /Trabajo de Sesión/);
});
