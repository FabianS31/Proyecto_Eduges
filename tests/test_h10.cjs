const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('H10 alta: teléfono guardado obligatorio, sin sustituirlo con el formulario', async () => {
    const src = fs.readFileSync('tests/test_h18.cjs','utf8').split('\ntest(')[0];
    const c = vm.createContext({require,console});
    vm.runInContext(src,c);
    const e = c.alta();
    vm.runInContext("tutoresDisponibles = [{dni:'20123456', telefono:null, movil:'123'}];",e.ctx);
    e.form.elements.tutor_telefono.value = 'No debe sobrescribir';
    await e.submit();
    assert.equal(e.calls.length,0);
});

test('H10 adicional: teléfono opcional en HTML y validación', () => {
    const html = fs.readFileSync('SistemaEduGes/Frontend/templates/componentes/modal_tutor.html','utf8');
    const input = html.match(/<input[^>]*id="add-tutor-telefono"[^>]*>/)[0];
    assert.doesNotMatch(input,/\brequired\b/);
    assert.match(html,/Teléfono \(opcional\)/);
    const src = fs.readFileSync('SistemaEduGes/Frontend/static/js/paginas/pacientes.js','utf8');
    const campos = Object.fromEntries(Object.entries({nombre:'Nombre',apellido:'Ficticio',dni:'12345678',
        telefono:'',mail:'ficticio@example.com',domicilio:'Ficticio',parentesco_id:'1'})
        .map(([k,value])=>[k,{value,checkValidity:()=>true}]));
    const c = vm.createContext({formAgregar:{elements:campos,addEventListener:(n,f)=>c.submit=f},
        estado:{fichaId:42},tutoresDisponibles:[],capitalizar:s=>s,$:()=>({disabled:false}),
        errorDomicilio:()=>null,guardar:opts=>c.opts=opts,tutores:{crear:d=>c.enviado=d},
        erroresAgregar:{},modalAgregar:{},cargarTutoresFicha(){}});
    const inicio = src.indexOf("formAgregar.addEventListener('submit'");
    vm.runInContext(src.slice(inicio,src.indexOf('\n    });',inicio)+8),c);
    c.submit({preventDefault(){}});
    assert.equal(Object.keys(c.opts.errores).length,0);
    c.opts.enviar();
    assert.equal(c.enviado.telefono,'');
});

test('H10 edición histórica: omite teléfono intacto y envía vaciado explícito', () => {
    const src = fs.readFileSync('SistemaEduGes/Frontend/static/js/paginas/pacientes.js','utf8');
    const campos = Object.fromEntries(Object.entries({nombre:'Nombre',apellido:'Ficticio',tutor_id:'1',
        telefono:'',mail:'ficticio@example.com',domicilio:'Ficticio'})
        .map(([k,value])=>[k,{value,checkValidity:()=>true,dataset:{}}]));
    campos.telefono.dataset.original='';
    const c = vm.createContext({formEditar:{elements:campos,addEventListener:(n,f)=>c.submit=f},
        capitalizar:s=>s,$:()=>({}),errorDomicilio:()=>null,guardar:opts=>c.opts=opts,
        tutores:{actualizar:(id,d)=>c.enviado=d},erroresEditar:{},modalEditar:{},cargarTutoresFicha(){},
        mailTutorOriginal:'ficticio@example.com',domicilioTutorOriginal:'Ficticio',
        nombresTutorOriginales:{nombre:'Nombre',apellido:'Ficticio'}});
    const inicio=src.indexOf("formEditar.addEventListener('submit'");
    vm.runInContext(src.slice(inicio,src.indexOf('\n    });',inicio)+8),c);
    c.submit({preventDefault(){}});c.opts.enviar();
    assert.equal('telefono' in c.enviado,false);
    campos.telefono.dataset.original='123';
    c.submit({preventDefault(){}});c.opts.enviar();
    assert.equal(c.enviado.telefono,null);
});
