// Integración con DOM y transporte simulados; no accede a servicios externos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const leer = p => fs.readFileSync(path.join(__dirname, '../SistemaEduGes/Frontend/static/js', p), 'utf8').replace(/\r/g, '');
const codigo = s => s.replace(/^import[\s\S]*?;\s*$/gm, '').replace(/\bexport /g, '');
const plain = x => JSON.parse(JSON.stringify(x));
const diferida = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
function entorno() {
    const nodes = new Map(), calls = [], notices = [], errors = [], events = [];
    function crear() { return {
        value:'', dataset:{}, disabled:false, hidden:false, children:[], handlers:{}, elements:{},
        classList:{add(){},remove(){},contains(){return false;}},
        addEventListener(n,f){ (this.handlers[n] ??= []).push(f); },
        async emit(n,e={}) { for(const f of this.handlers[n] || []) await f({target:this,preventDefault(){},...e}); },
        focus(){}, querySelector(){return null;}, querySelectorAll(){return [];},
        reset(){for(const c of Object.values(this.elements)) c.value='';},
        appendChild(c){this.children.push(c);}, replaceChildren(){this.children=[];this.value='';},
    }; }
    const node = id => {if(!nodes.has(id)) nodes.set(id,crear()); return nodes.get(id);};
    const modals = new Map();
    const ctx = vm.createContext({
        console:{error(){},warn(){}}, document:{getElementById:node,createElement:crear,activeElement:null},
        window:{dispatchEvent:e=>events.push(e),confirm:()=>true,bootstrap:{Modal:{getOrCreateInstance(el){
            if(!modals.has(el)) modals.set(el,{
                visible:false,show(){this.visible=true;el.emit('show.bs.modal');},
                hide(){let stop=false; for(const f of el.handlers['hide.bs.modal']||[]) f({preventDefault(){stop=true;}});
                    if(!stop){this.visible=false;el.emit('hidden.bs.modal');}}
            }); return modals.get(el);
        }}}},
        CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail;}},
        api:{get:async url=>{calls.push({method:'get',url});return ctx.get(url);},
            patch:async(url,data)=>{calls.push({method:'patch',url,data:plain(data)});return ctx.reply();},
            post:async(url,data)=>{calls.push({method:'post',url,data:plain(data)});return ctx.reply();}},
        get:async()=>[], reply:async()=>({}), ESTADO_PACIENTE:{ACTIVO:1},
        botonCargando:(b,v)=>{b.disabled=v;}, limpiarErroresFormulario(){},
        mostrarErroresFormulario:(form,error)=>{errors.push(error);return [error.message];},
        html:()=>'', renderizar(){}, icono:()=>'', bloqueError:()=>'',
        normalizarTexto:s=>s.toLowerCase(),notificar:m=>notices.push(m),notificarError:e=>errors.push(e),
    });
    const api = leer('api.js'); const classEnd = api.indexOf('\n}', api.indexOf('export class ApiError')) + 2;
    vm.runInContext(codigo(api.slice(0,classEnd)),ctx);
    vm.runInContext(codigo(leer('endpoints.js')),ctx);
    vm.runInContext(codigo(leer('componentes/formularios.js')),ctx);
    return {ctx,node,calls,notices,errors,events,modals};
}
const paciente = {id_paciente:7,nombre:'Ana',apellido:'Prueba',dni:'12345678',fecha_nacimiento:'2010-01-01',direccion:'Domicilio',
    mail:null,cud_numero:null,cud_vencimiento:null,obra_social:{id:9,nombre:'Anterior inactiva'},numero_afiliado:'AF1'};
function editorPaciente() {
    const e=entorno(); const form=e.node('form-editar-paciente');
    for(const k of Object.keys(paciente).filter(k=>k!=='id_paciente')) form.elements[k]= {value:''};
    form.elements.obra_social=e.node('select-obra');
    vm.runInContext(codigo(leer('componentes/editar-paciente.js')),e.ctx);
    e.ctx.saved=[];e.ctx.closed=[];
    vm.runInContext('globalThis.abrir = prepararEdicionPaciente({alGuardar:p=>saved.push(p),alCerrar:id=>closed.push(id)});',e.ctx);
    e.submit=()=>form.emit('submit');
    e.ctx.get=async()=>[{id:20,nombre:'Nueva'}];
    e.form=form;
    return e;
}
test('paciente: conserva cobertura inactiva y envía únicamente datos cambiados',async()=>{
    const e=editorPaciente();await e.ctx.abrir(paciente);
    assert.equal(e.form.elements.obra_social.value,'9');
    assert.equal(e.form.elements.obra_social.children[0].textContent,'Anterior inactiva');
    e.form.elements.direccion.value='Domicilio nuevo';e.form.elements.obra_social.value='20';
    e.ctx.reply=async()=>({...paciente,direccion:'Domicilio nuevo'});
    await e.submit();
    assert.deepEqual(e.calls.at(-1),{method:'patch',url:'/pacientes/7/',data:{direccion:'Domicilio nuevo',obra_social:20}});
    assert.equal(e.ctx.saved.length,1);assert.equal(e.notices.length,1);
});
for(const status of [400,403,500,0]) test(`paciente: error ${status} conserva formulario sin falso éxito`,async()=>{
    const e=editorPaciente();await e.ctx.abrir(paciente);
    e.form.elements.nombre.value='Cambio';
    e.ctx.reply=async()=>{throw vm.runInContext(`new ApiError(${status}, {detail:'rechazado'})`,e.ctx);};
    await e.submit();assert.equal(e.ctx.saved.length,0);assert.equal(e.notices.length,0);
    assert.equal(e.form.elements.nombre.value,'Cambio');assert.equal(e.errors.length,1);
    assert.equal(e.node('btn-guardar-editar-paciente').disabled,false);
});
test('paciente: doble envío y cierre durante guardado no duplican la operación',async()=>{
    const e=editorPaciente();await e.ctx.abrir(paciente);const wait=diferida();e.ctx.reply=()=>wait.promise;
    const submit=e.submit();await e.submit();
    const modal=e.modals.get(e.node('modal-editar-paciente'));modal.hide();assert.equal(modal.visible,true);
    assert.equal(e.calls.filter(c=>c.method==='patch').length,1);
    wait.resolve(paciente);await submit;assert.equal(modal.visible,false);
});
test('paciente: cargas fallidas y respuestas anteriores no habilitan Guardar',async()=>{
    const e=editorPaciente(), old=diferida();e.ctx.get=()=>old.promise;
    const pending=e.ctx.abrir(paciente);await e.submit();assert.equal(e.calls.length,1);
    e.modals.get(e.node('modal-editar-paciente')).hide();
    e.ctx.get=async()=>{throw new Error('red');};await e.ctx.abrir({...paciente,id_paciente:8});
    old.resolve([{id:77,nombre:'Vieja'}]);await pending;
    assert.equal(e.node('btn-guardar-editar-paciente').disabled,true);await e.submit();
    assert.equal(e.calls.filter(c=>c.method==='patch').length,0);
});
function obras() {
    const e=entorno();vm.runInContext(codigo(leer('componentes/obras-sociales-modal.js')),e.ctx);
    const obra={id:11,nombre:'Obra',contacto:'123',mail:'obra@example.com',web:'https://example.com',estado:{id:1},tipo:{id:4}};
    e.ctx.get=async()=>[obra];
    vm.runInContext('inicializarModalObrasSociales()',e.ctx);
    for(const campo of ['nombre','contacto','mail','web']) {
        e.node('form-crear-obra-social').elements[campo]=e.node(`os-${campo}`);
    }
    e.open=()=>e.node('modal-obras-sociales').emit('show.bs.modal');
    e.edit=()=>e.node('os-tabla-cuerpo').emit('click',{target:{closest:s=>s.includes('editar-os')?{dataset:{osId:'11'}}:null}});
    e.submit=()=>e.node('form-crear-obra-social').emit('submit');return e;
}
test('obra social: edición parcial sin tipo/estado, evento y retorno al alta',async()=>{
    const e=obras();await e.open();await e.edit();e.node('os-nombre').value='Actualizada';
    await e.submit();
    assert.deepEqual(e.calls.find(c=>c.method==='patch'),{method:'patch',url:'/obras-sociales/11/',data:{nombre:'Actualizada'}});
    assert.equal(e.events[0].detail.accion,'actualizada');assert.equal(e.notices.length,1);
    assert.equal(e.node('btn-cancelar-edicion-os').hidden,true);
    e.node('os-nombre').value='Alta nueva';
    await e.submit();assert.equal(e.calls.at(-2).method,'post');
});
for(const status of [400,403,500,0]) test(`obra social: rechazo ${status} no emite éxito ni actualización`,async()=>{
    const e=obras();await e.open();await e.edit();
    e.ctx.reply=async()=>{throw vm.runInContext(`new ApiError(${status}, {detail:'rechazado'})`,e.ctx);};
    await e.submit();assert.equal(e.notices.length,0);assert.equal(e.events.length,0);
    assert.equal(e.errors.length,1);assert.equal(e.node('btn-cancelar-edicion-os').hidden,false);
});
test('obra social: cancelar edición vuelve al alta sin PATCH',async()=>{
    const e=obras();await e.open();await e.edit();await e.node('btn-cancelar-edicion-os').emit('click');
    assert.equal(e.node('btn-cancelar-edicion-os').hidden,true);
    assert.equal(e.calls.filter(c=>c.method==='patch').length,0);
});
test('cachés: error conserva datos; edición exitosa invalida pacientes y turnos',async()=>{
    const e=entorno();e.ctx.get=async()=>[{id:1}];
    await vm.runInContext('pacientes.listar()',e.ctx);await vm.runInContext('turnos.listar()',e.ctx);
    e.ctx.reply=async()=>{throw new Error('red');};
    await assert.rejects(vm.runInContext('pacientes.actualizar(7,{nombre:"Nuevo"})',e.ctx));
    await vm.runInContext('pacientes.listar()',e.ctx);await vm.runInContext('turnos.listar()',e.ctx);
    assert.equal(e.calls.filter(c=>c.method==='get').length,2);
    e.ctx.reply=async()=>paciente;await vm.runInContext('pacientes.actualizar(7,{nombre:"Nuevo"})',e.ctx);
    await vm.runInContext('pacientes.listar()',e.ctx);await vm.runInContext('turnos.listar()',e.ctx);
    assert.equal(e.calls.filter(c=>c.method==='get').length,4);
});
test('buscador pacientes: borrar recupera listado y descarta búsquedas fuera de orden',async()=>{
    const e=entorno();const source=leer('paginas/pacientes.js'), start=source.indexOf('async function cargarListado(');
    const fn=source.slice(start,source.indexOf('\n}',start)+2);
    Object.assign(e.ctx,{estado:{peticionListado:0,todos:[]},$:e.node,estadoCud:()=>'',edad:()=>10,
        cargarProximos:async()=>{},bloqueCargando:()=>'',actualizarConteosCud(){},mostrarListado(){},mostrarError(){}});
    vm.runInContext(fn,e.ctx);
    const old=diferida();e.ctx.get=url=>url.includes('buscar=A')?old.promise:Promise.resolve([{id_paciente:2}]);
    const pending=vm.runInContext('cargarListado("A")',e.ctx);
    await vm.runInContext('cargarListado("")',e.ctx);old.resolve([{id_paciente:1}]);await pending;
    assert.equal(e.ctx.estado.todos[0].id_paciente,2);
});
test('pacientes: conserva filtros combinados y refleja obra social editada',()=>{
    const e=entorno(), source=leer('paginas/pacientes.js');
    Object.assign(e.ctx,{estado:{todos:[
        {...paciente,estado:1,cud:{clave:'vigente'},fecha_alta:'2026-01-10'},
        {...paciente,id_paciente:8,estado:2,cud:{clave:'vencido'},fecha_alta:'2025-01-10'},
    ],filtros:{q:'Ana',cud:'vigente',orden:'apellido',estado:'Activo',obraSocial:'9',altaDesde:'2026-01-01',altaHasta:'2026-12-31'}},
        coincide:(p,q)=>p.nombre.includes(q),ALERTA:'alerta',CUD:{},CRITERIOS:{apellido:()=>0}});
    const start=source.indexOf('function filtrados()');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),e.ctx);
    assert.equal(vm.runInContext('filtrados().length',e.ctx),1);
    e.ctx.estado.todos[0].obra_social={id:20,nombre:'Nueva'};
    assert.equal(vm.runInContext('filtrados().length',e.ctx),0);
    e.ctx.estado.filtros.obraSocial='20';assert.equal(vm.runInContext('filtrados().length',e.ctx),1);
});
test('pacientes: restablecer filtros recupera el listado e invalida solicitudes anteriores',async()=>{
    const e=entorno(), source=leer('paginas/pacientes.js');
    const start=source.indexOf("formulario.addEventListener('reset'");
    const end=source.indexOf('\n    prepararPaginacion',start);
    Object.assign(e.ctx,{formulario:e.node('filtros'),estado:{usuario:{},peticionListado:3,filtros:{q:'Ana',obraSocial:'9'}},
        esProfesional:()=>true,setTimeout:f=>f(),cargarListado:()=>{e.ctx.recargas++;},recargas:0,
        cambiarFiltros:c=>Object.assign(e.ctx.estado.filtros,c)});
    vm.runInContext(source.slice(start,end),e.ctx);await e.node('filtros').emit('reset');
    assert.equal(e.ctx.estado.peticionListado,4);assert.equal(e.ctx.recargas,1);
    assert.equal(e.ctx.estado.filtros.q,'');assert.equal(e.ctx.estado.filtros.obraSocial,'');
});
