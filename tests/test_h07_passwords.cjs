const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const leer = p => fs.readFileSync('SistemaEduGes/Frontend/static/js/' + p, 'utf8');

test('H07 cambio: exteriores rechazados, interiores y confirmación conservados', () => {
    const src = leer('layout.js');
    const c = vm.createContext({LARGO_MINIMO_PASSWORD:8});
    vm.runInContext(src.slice(src.indexOf('function validarPassword('), src.indexOf('async function cambiarPassword(')), c);
    for (const blanco of [' ', '\t', '\n', '\r', '\u00a0', '\u0085', '\u001c']) {
        for (const nueva of [blanco+'Ficticia123', 'Ficticia123'+blanco]) {
            assert.ok(c.validarPassword('Anterior123', nueva, nueva).password_nueva);
        }
        const nueva = 'Ficticia'+blanco+'123';
        assert.equal(Object.keys(c.validarPassword('Anterior123', nueva, nueva)).length, 0);
    }
    assert.ok(c.validarPassword('Anterior123','Nueva123','Distinta123').password_confirmacion);
    assert.ok(c.validarPassword('Anterior123','1234567','1234567').password_nueva);
    assert.equal(Object.keys(c.validarPassword('Anterior123','X'.repeat(129),'X'.repeat(129))).length,0);
});

test('H07 profesional: validar sin modificar el valor y conservar confirmación', () => {
    const src = leer('paginas/profesionales.js');
    const c = vm.createContext({document: {}, ApiError: class extends Error {}});
    vm.runInContext(((s => s.slice(s.indexOf('export function errorDomicilio(')).replace(/\bexport\s+/g, ''))(leer('componentes/formularios.js'))), c);
    vm.runInContext(src.slice(src.indexOf('function validarAlta('),src.indexOf('function prepararAlta(')),c);
    const datos = {nombre:'Nombre',apellido:'Ficticio',dni:'12345678',matricula:'Ficticia',especialidad:1,usuario:'ficticio'};
    for (const valor of [' Ficticia123','Ficticia123 ','\tFicticia123','Ficticia123\n']) {
        datos.password = datos.password_confirm = valor;
        assert.ok(c.validarAlta(datos,{}).password);
        assert.equal(datos.password,valor);
    }
    datos.password = datos.password_confirm = 'Ficticia 123';
    assert.equal(Object.keys(c.validarAlta(datos,{})).length,0);
    datos.password_confirm = 'Distinta123';
    assert.ok(c.validarAlta(datos,{}).password_confirm);
});

test('H07 administrador: bloquea exteriores y máximo, envía interiores intactos', async () => {
    const arnes = fs.readFileSync('tests/test_altas_administracion.cjs','utf8').split("for (const tipo of")[0];
    const c = vm.createContext({require,console,__dirname:__dirname});
    vm.runInContext(arnes+'\nglobalThis.crear = entorno;',c);
    for (const valor of [' Ficticia123','Ficticia123 ','\tFicticia123','Ficticia123\n','X'.repeat(129),'Ficticia 123','X'.repeat(128)]) {
        const e = c.crear();
        e.node('nuevo-usuario-nombre').value='ficticio';
        e.node('nuevo-usuario-password').value=valor;
        e.node('nuevo-usuario-password-confirm').value=valor;
        vm.runInContext('prepararModalNuevoUsuario()',e.ctx);
        await e.node('form-nuevo-usuario').handlers.submit({preventDefault(){}});
        const valido = valor==='Ficticia 123' || valor.length===128;
        assert.equal(e.calls.length,valido?1:0);
        if (valido) assert.equal(e.calls[0].data.password,valor);
        assert.equal(e.node('nuevo-usuario-password').value,valor);
    }
});
