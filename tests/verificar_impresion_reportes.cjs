// Ejecutar explícitamente: node tests/verificar_impresion_reportes.cjs
// Integración de impresión en Chromium/Edge, con datos ficticios y sin base de datos.
// Requiere Playwright y el CSS Bootstrap 5.3.3 usado por base.html.
// PLAYWRIGHT_MODULE: ruta opcional al módulo; BOOTSTRAP_CSS: CSS local.
// PRINT_OUTPUT: carpeta de salida; por defecto usa el directorio temporal del sistema.
// Con PRINT_BASELINE=1 solo registra medidas. Revisar también todas las páginas del PDF.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'SistemaEduGes/Frontend');
const output = process.env.PRINT_OUTPUT || path.join(require('node:os').tmpdir(), 'eduges-impresion-reportes');
const bootstrap = fs.readFileSync(process.env.BOOTSTRAP_CSS || path.join(output, 'bootstrap.min.css'));
const read = p => fs.readFileSync(path.join(frontend, p), 'utf8');
const content = read('templates/reportes.html').match(/{% block content %}([\s\S]*?){% endblock %}/)[1];
const documentHTML = read('templates/base.html')
    .replace(/{% block content %}[\s\S]*?{% endblock %}/, content)
    .replace(/{% static '([^']+)' %}/g, '/static/$1')
    .replace(/{%[\s\S]*?%}/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]*fonts\.google[^>]*>/g, '');
const pacientes = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1, nombre: ['Ana María', 'Juan Ignacio', 'Lucía', 'Martín', 'Sofía'][i],
    apellido: 'Fernández de la Vega', dni: `4012345${i}`, fecha_alta: '2026-11-01',
    fecha_nacimiento: '2010-04-15', mail: `paciente${i}.apellidoextenso@example.invalid`,
    profesionales_asignados: [{ nombre: 'María Alejandra', apellido: 'González Fernández' },
        { nombre: 'José Ignacio', apellido: 'Rodríguez' }],
    obra_social: { nombre: 'Obra Social de Trabajadores de la Educación' },
    numero_afiliado: `AFILIACION12345678901234567890${i}`,
    cud_vencimiento: '2027-12-31', estado: { id: i === 4 ? 2 : 1, nombre: i === 4 ? 'Inactivo' : 'Activo' },
}));
const turnos = pacientes.map((p, i) => ({ id: p.id, fecha: '2026-11-15', hora: '09:00',
    paciente: p, profesional: { nombre: 'María', apellido: 'Pérez' },
    estado: { id: 4, nombre: 'Realizado' }, trabajo_sesion: `Actividad ficticia ${i + 1}` }));
const profesionales = pacientes.map(p => ({ id: p.id, nombre: p.nombre, apellido: 'Pérez',
    dni: p.dni, matricula: 'MP-12345', especialidad: { nombre: 'Psicología' },
    contacto: '1123456789', mail: 'prueba@example.invalid', estado_profesional: { id: 1, nombre: 'Activo' } }));

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true,
        executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    try {
        const page = await browser.newPage();
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/css', body: bootstrap });
            if (url.hostname !== 'eduges.test') return route.abort();
            if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: documentHTML });
            if (url.pathname === '/api/auth/me/') return route.fulfill({ json: {
                usuario: 'Prueba ficticia', rol: { nombre: 'Profesional' }, permisos: [],
            } });
            if (!url.pathname.startsWith('/static/')) throw new Error(`Petición no permitida: ${url.pathname}`);
            const file = path.resolve(frontend, '.' + url.pathname);
            assert.ok(file.startsWith(frontend + path.sep));
            let body = fs.readFileSync(file);
            if (url.pathname.endsWith('/paginas/reportes.js')) body = body.toString() + `
                export function prepararImpresion(tipo, items, esPro, rol) {
                    estado.tipo = tipo; estado.resultados = items; estado.esPro = esPro;
                    estado.usuario = {usuario:'Prueba ficticia',rol:{nombre:rol}};
                    actualizarVisibilidadFiltros(); renderizarKPIs(); renderizarTabla(); actualizarMembreteImpresion();
                }`;
            return route.fulfill({ body, contentType: file.endsWith('.js') ? 'text/javascript'
                : file.endsWith('.css') ? 'text/css' : 'image/png' });
        });
        await page.goto('http://eduges.test/');
        // Importar después de DOMContentLoaded evita inicializar llamadas API: solo renderizado real.
        await page.evaluate(async () => { window.reportePrueba = await import('/static/js/paginas/reportes.js'); });
        const resultados = [];
        const escenarios = [
            ['turnos', 'Administrador'], ['turnos', 'Profesional'], ['turnos', 'SuperAdministrador'],
            ['pacientes', 'Administrador'], ['pacientes', 'Profesional'],
            ['profesionales', 'Administrador'], ['profesionales', 'SuperAdministrador'],
        ];
        for (const [tipo, rol] of escenarios) for (const cantidad of [1, 4, 5, 7, 20]) {
            const fuente = tipo === 'turnos' ? turnos : tipo === 'pacientes' ? pacientes : profesionales;
            const items = Array.from({length: cantidad}, (_, i) => {
                const item = structuredClone(fuente[i % fuente.length]);
                item.id = i + 1;
                if (tipo === 'pacientes' && [4, 7].includes(cantidad)) {
                    item.apellido = 'Pérez';
                    item.mail = `paciente${i}@example.invalid`;
                    item.profesionales_asignados = [{nombre: 'María', apellido: 'Gómez'}];
                    item.obra_social.nombre = 'Cobertura de prueba';
                    item.numero_afiliado = `AF-${i + 1}`;
                }
                if (cantidad === 20 && tipo === 'turnos') item.trabajo_sesion =
                    `Atenci\u00f3n y acompa\u00f1amiento: actividades de comunicaci\u00f3n, coordinaci\u00f3n y memoria.\nSegunda l\u00ednea; texto completo autorizado. FIN-SESION-${i + 1}`;
                if (cantidad === 20 && tipo === 'profesionales') {
                    item.especialidad.nombre = 'Psicolog\u00eda cl\u00ednica y acompa\u00f1amiento terap\u00e9utico interdisciplinario';
                    item.mail = `profesional.apellido.extenso${i + 1}@example.invalid`;
                }
                return item;
            });
            const esPro = rol === 'Profesional';
            const nombre = `${tipo}-${rol}-${cantidad}`;
            await page.evaluate(args => window.reportePrueba.prepararImpresion(...args), [tipo, items, esPro, rol]);
            await page.emulateMedia({ media: 'print' });
            const horizontal = tipo === 'pacientes' && !process.env.PRINT_BASELINE;
            const ancho = (horizontal ? 269 : 182) * 96 / 25.4;
            await page.setViewportSize({ width: Math.floor(ancho), height: 1000 });
            const medidas = await page.evaluate(() => {
                const rect = s => { const r = document.querySelector(s).getBoundingClientRect();
                    return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width }; };
                return { tabla: rect('#tabla-reporte'), encabezado: rect('#reporte-membrete-print'),
                    indicadores: rect('#reporte-kpis'), firma: rect('.eg-print-signature-box'),
                    tarjetas: [...document.querySelectorAll('#reporte-kpis .eg-stat')].map(e => ({right:e.getBoundingClientRect().right, overflow:e.scrollWidth > e.clientWidth + 2})),
                    truncados: [...document.querySelectorAll('#tabla-reporte .text-truncate')].filter(e => e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2).length,
                    pie: rect('.eg-card__foot'), filas: document.querySelectorAll('#reporte-cuerpo tr').length,
                    desbordes: [...document.querySelectorAll('#tabla-reporte th, #tabla-reporte td')]
                        .filter(e => getComputedStyle(e).display !== 'none' && e.scrollWidth > e.clientWidth + 2)
                        .map(e => e.textContent.trim()) };
            });
            resultados.push({ nombre, ancho, ...medidas });
            if (!process.env.PRINT_BASELINE) {
                assert.equal(medidas.filas, cantidad);
                assert.equal(medidas.truncados, 0);
                assert.ok(medidas.tarjetas.every(t => t.right <= ancho + 1 && !t.overflow), `${nombre}: indicador desbordado`);
                assert.ok(medidas.tabla.right <= ancho + 1, `${nombre}: tabla fuera de página`);
                assert.deepEqual(medidas.desbordes, [], `${nombre}: texto desbordado`);
                assert.ok(medidas.encabezado.bottom <= medidas.indicadores.y);
                assert.ok(medidas.indicadores.bottom <= medidas.tabla.y);
                assert.ok(medidas.tabla.bottom <= medidas.pie.y);
                assert.ok(medidas.firma.right <= ancho + 1);
            }
            await page.pdf({ path: path.join(output, `${process.env.PRINT_BASELINE ? 'antes-' : ''}${nombre}.pdf`),
                preferCSSPageSize: true, printBackground: true });
            if (process.env.PDF_PYTHON && !process.env.PRINT_BASELINE) {
                const textos = JSON.parse(require('node:child_process').execFileSync(process.env.PDF_PYTHON,
                    ['-c', 'import sys,json; from pypdf import PdfReader; print(json.dumps([p.extract_text() for p in PdfReader(sys.argv[1]).pages]))',
                        path.join(output, `${nombre}.pdf`)], {encoding: 'utf8'}));
                if ([1, 4, 7].includes(cantidad)) assert.equal(textos.length, 1, `${nombre}: páginas innecesarias`);
                for (const texto of textos) {
                    assert.ok(items.some(item => texto.includes((item.nombre || item.paciente.nombre).split(' ')[0])), `${nombre}: página sin registros`);
                }
                assert.ok(textos.join('\n').includes('Firma y Sello del Profesional'), `${nombre}: falta firma`);
            }
        }
        fs.writeFileSync(path.join(output, process.env.PRINT_BASELINE ? 'antes.json' : 'medidas.json'), JSON.stringify(resultados, null, 2));
        console.log(JSON.stringify(resultados, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
