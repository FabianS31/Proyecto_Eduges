const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../SistemaEduGes/Frontend');
const leer = p => fs.readFileSync(path.join(root, p),'utf8').replace(/\r/g,'');
const codigo = s => s.replace(/^import[\s\S]*?;\s*$/gm,'').replace(/\bexport /g,'');
const source = leer('static/js/paginas/pacientes.js');
const funcion = name => {const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);};
function entorno() {
    const nodes=new Map(), calls=[], notices=[],errors=[], refreshed=[];
    const node=id=>{
        if(!nodes.has(id)) nodes.set(id,{value:'',disabled:false,dataset:{},handlers:{},classList:{add(){},contains(){return true;}},
            addEventListener(n,f){(this.handlers[n]??=[]).push(f);},reset(){},focus(){},
            async emit(n,e={}){for(const f of this.handlers[n]||[])await f({preventDefault(){},...e});}});
        return nodes.get(id);
    };
    const ctx=vm.createContext({$:node,document:{getElementById:node,body:node('body')},
        window:{bootstrap:{Modal:{getOrCreateInstance:()=>({show(){},hide(){}})}}},
        estado:{fichaId:7,usuario:{}},api:{post:async(url,data)=>{calls.push({url,data:JSON.parse(JSON.stringify(data))});return ctx.reply();}},
        ESTADO_PACIENTE:{},reply:async()=>({}),confirmar:async()=>true,
        crearCombobox:()=>({limpiar(){}}),notificar:m=>notices.push(m),notificarError:e=>errors.push(e),
        cargarTutoresFicha:async id=>refreshed.push(id),
    });
    vm.runInContext(codigo(leer('static/js/endpoints.js')),ctx);
    vm.runInContext(funcion('prepararGestionTutores')+'\nprepararGestionTutores();',ctx);
    const button={disabled:false,dataset:{principalId:'10',relacionId:'11',tutorNombre:'Ficticio'}};
    const click=()=>node('ficha-paciente').emit('click',{target:{closest:s=>s==='[data-accion="reemplazar-principal"]'?button:null}});
    return {ctx,calls,notices,errors,refreshed,button,click};
}
test('reemplazo: confirmación y contrato explícito; refresca solo después de éxito',async()=>{
    const e=entorno();await e.click();
    assert.deepEqual(e.calls,[{url:'/tutores/relaciones/10/reemplazar-principal/',data:{nueva_relacion_id:11}}]);
    assert.equal(e.notices.length,1);assert.deepEqual(e.refreshed,[7]);
});
test('reemplazo: cancelar no escribe',async()=>{
    const e=entorno();e.ctx.confirmar=async()=>false;await e.click();assert.equal(e.calls.length,0);
});
test('reemplazo: error de servidor/red no muestra éxito ni cambia la ficha',async()=>{
    const e=entorno();e.ctx.reply=async()=>{throw new Error('403/400/red');};await e.click();
    assert.equal(e.notices.length,0);assert.equal(e.refreshed.length,0);assert.equal(e.errors.length,1);
    assert.equal(e.button.disabled,false);
});
test('reemplazo: no acepta doble clic ni confirmación para una ficha cerrada',async()=>{
    const e=entorno();let resolver;e.ctx.confirmar=()=>new Promise(r=>{resolver=r;});
    const primera=e.click();await e.click();e.ctx.estado.fichaId=8;resolver(true);await primera;
    assert.equal(e.calls.length,0);assert.equal(e.button.disabled,false);
});
test('reemplazo: respuesta tardía no recarga la ficha de otro paciente',async()=>{
    const e=entorno();let resolver;e.ctx.reply=()=>new Promise(r=>{resolver=r;});
    const pendiente=e.click();await new Promise(r=>setImmediate(r));
    e.ctx.estado.fichaId=8;resolver({});await pendiente;assert.equal(e.refreshed.length,0);
});
test('solo se ofrece reemplazo para secundarios cuando hay un único principal',async()=>{
    for(const principales of [0,1,2]) {
        let html='';const tutors=[0,1,2].map(i=>({id:i,nombre:'Tutor',apellido:String(i),relaciones:[
            {id:i,paciente:{id:7},activo:true,responsable_principal:i<principales,parentesco:{nombre:'Tutor'}}]}));
        const ctx=vm.createContext({estado:{fichaId:7,usuario:{}},$:()=>({}),tutores:{listar:async()=>tutors},
            renderizar:(n,text)=>{html=text;},bloqueCargando:()=>'',icono:()=>'',esProfesional:()=>true,
            html:(s,...v)=>s.reduce((a,x,i)=>a+x+(Array.isArray(v[i])?v[i].join(''):v[i]??''),'')});
        vm.runInContext('async '+funcion('cargarTutoresFicha'),ctx);await vm.runInContext('cargarTutoresFicha(7)',ctx);
        assert.equal((html.match(/data-accion="reemplazar-principal"/g)||[]).length,principales===1?2:0);
    }
});
test('edición explícita advierte sobre todas las vinculaciones',()=>{
    assert.ok(leer('templates/componentes/modal_tutor.html').includes(
        'Este tutor puede estar vinculado a otros pacientes. Los cambios en sus datos se reflejarán en todas sus vinculaciones'));
});
