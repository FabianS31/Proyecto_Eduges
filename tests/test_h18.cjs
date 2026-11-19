const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function alta() {
    // Reutilizar el arnés DOM existente sin ejecutar ni modificar sus pruebas.
    const fuente = fs.readFileSync('tests/test_altas_etapa4b.cjs', 'utf8').split('\ntest(')[0];
    const contexto = vm.createContext({
        require, console,
        validarNombrePersonal: valor => [...String(valor ?? '')].length > 60
            ? 'El nombre no puede superar los 60 caracteres.' : null,
    });
    vm.runInContext(fuente + '\nglobalThis.crear = entorno;', contexto);
    return contexto.crear();
}

test('H18 alta: reutiliza histórico autorizado sin enviar datos personales', async () => {
    const e = alta();
    vm.runInContext("tutoresDisponibles = [{dni:'20123456', mail:'', telefono:'123'}];", e.ctx);
    for (const campo of ['nombre','apellido','telefono','mail','domicilio']) {
        e.form.elements['tutor_' + campo].value = '';
    }
    e.form.elements.direccion.value = 'X'.repeat(226);
    await e.submit();
    assert.equal(e.calls.length, 1);
    assert.deepEqual(Object.keys(e.calls[0].tutor).sort(), ['dni','parentesco_id','responsable_principal']);
    assert.equal(e.calls[0].direccion.length, 226);
});

test('H18 alta: cambiar DNI vuelve a exigir datos de creación', async () => {
    const e = alta();
    vm.runInContext("tutoresDisponibles = [{dni:'20888888'}];", e.ctx);
    e.form.elements.tutor_mail.value = '';
    await e.submit();
    assert.equal(e.calls.length, 0);
});

test('H18 ficha: reutilización omite datos personales y conserva parentesco', () => {
    const fuente = fs.readFileSync('SistemaEduGes/Frontend/static/js/paginas/pacientes.js', 'utf8');
    const campos = Object.fromEntries(['nombre','apellido','dni','telefono','mail','domicilio','parentesco_id']
        .map(k => [k, {value:'', checkValidity:()=>false}]));
    campos.dni.value = '20123456'; campos.parentesco_id.value = '1';
    const formJs = ((s => s.slice(s.indexOf('export function errorDomicilio(')).replace(/\bexport\s+/g, ''))(fs.readFileSync('SistemaEduGes/Frontend/static/js/componentes/formularios.js','utf8')));
    const c = vm.createContext({formAgregar:{elements:campos,addEventListener:(n,f)=>c.submit=f},
        estado:{fichaId:42}, tutoresDisponibles:[{dni:'20123456'}],
        capitalizar:s=>s, $:()=>({disabled:false}), document:{}, ApiError:class extends Error{},
        guardar:opciones=>c.opciones=opciones, tutores:{crear:datos=>c.datos=datos},
        erroresAgregar:{}, modalAgregar:{}, cargarTutoresFicha(){}});
    vm.runInContext(formJs, c);
    const inicio = fuente.indexOf("formAgregar.addEventListener('submit'");
    vm.runInContext(fuente.slice(inicio, fuente.indexOf('\n    });', inicio) + 8), c);
    c.submit({preventDefault(){}});
    assert.equal(Object.keys(c.opciones.errores).length, 0);
    c.opciones.enviar();
    assert.deepEqual(Object.keys(c.datos).sort(), ['dni','paciente_id','parentesco_id','responsable_principal']);
    campos.dni.value = '20888888';
    c.submit({preventDefault(){}});
    assert.ok(c.opciones.errores.mail);
});
