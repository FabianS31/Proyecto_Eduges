const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('SistemaEduGes/Frontend/static/js/componentes/catalogo-parentescos.js','utf8')
    .replace(/^import .*;$/m,'').replace('export async','async');
function entorno(respuesta) {
    let calls=0;
    const select={dataset:{},disabled:true,value:'',options:[],
        set innerHTML(v){this.options=[];this.value='';},
        appendChild(o){o.value=String(o.value);this.options.push(o);}};
    const aviso={},retry={};
    const ctx=vm.createContext({catalogos:{parentescos:()=>{calls++;return respuesta();}},
        document:{createElement:()=>({})}});
    vm.runInContext(source,ctx);
    return {select,aviso,retry,load:()=>ctx.cargarParentescos(select,aviso,retry),calls:()=>calls};
}
test('IDs reales, texto seguro y seleccion valida conservada',async()=>{
    const e=entorno(async()=>[{id:84,nombre:'<b>Tutor</b>'}]);e.select.value='84';
    await e.load();assert.equal(e.select.value,'84');assert.equal(e.select.disabled,false);
    assert.equal(e.select.options[0].textContent,'<b>Tutor</b>');
    assert.equal(e.select.options[0].value,'84');assert.equal(e.retry.hidden,true);
    await e.load();assert.equal(e.calls(),1);
});
test('seleccion obsoleta se elimina',async()=>{
    const e=entorno(async()=>[{id:84,nombre:'Tutor'}]);e.select.value='1';await e.load();assert.equal(e.select.value,'');
});
test('vacio, error de red y errores Backend permiten reintentar sin fallback',async()=>{
    for(const fallo of [[],0,403,500,{results:[]}]){
        let falla=true;
        const e=entorno(async()=>{if(!falla)return [{id:37,nombre:'Otro'}];if(typeof fallo==='number')throw Error(String(fallo));return fallo;});
        await e.load();assert.equal(e.select.disabled,true);assert.equal(e.select.options.length,0);
        assert.equal(e.retry.hidden,false);assert.ok(e.aviso.textContent.length);
        falla=false;await e.retry.onclick();assert.equal(e.select.disabled,false);assert.equal(e.select.options[0].value,'37');
    }
});
test('solicitud unica y cierre durante carga no restaura seleccion anterior',async()=>{
    let resolve;const e=entorno(()=>new Promise(r=>resolve=r));e.select.value='84';
    const p=e.load();await e.load();assert.equal(e.calls(),1);assert.equal(e.select.disabled,true);
    e.select.value='';resolve([{id:84,nombre:'Tutor'}]);await p;assert.equal(e.select.value,'');
});
