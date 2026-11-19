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
        URL, console:{error(){},warn(){}}, document:{getElementById:node,createElement:crear,activeElement:null},
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
test('paciente: rechaza DNI nuevo invalido y conserva DNI historico no editado',async()=>{
    const e=editorPaciente();await e.ctx.abrir({...paciente,dni:'HISTORICO'});
    e.form.elements.direccion.value='Nuevo domicilio';await e.submit();
    assert.deepEqual(e.calls.at(-1).data,{direccion:'Nuevo domicilio'});
    await e.ctx.abrir(paciente);const antes=e.calls.filter(c=>c.method==='patch').length;
    e.form.elements.dni.value='ABC';await e.submit();
    assert.equal(e.calls.filter(c=>c.method==='patch').length,antes);
    e.form.elements.dni.value='1234567';await e.submit();
    assert.equal(e.calls.filter(c=>c.method==='patch').length,antes+1);
});

test('paciente: valida apellido modificado sin bloquear el historico',async()=>{
    const e=editorPaciente();await e.ctx.abrir({...paciente,apellido:'535345345'});
    e.form.elements.direccion.value='Otro domicilio';await e.submit();
    assert.deepEqual(e.calls.at(-1).data,{direccion:'Otro domicilio'});
    await e.ctx.abrir(paciente);const n=e.calls.filter(c=>c.method==='patch').length;
    e.form.elements.apellido.value='535345345';await e.submit();
    assert.equal(e.calls.filter(c=>c.method==='patch').length,n);
    e.form.elements.apellido.value="Muñoz O'Connor";await e.submit();
    assert.equal(e.calls.filter(c=>c.method==='patch').length,n+1);
});

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
    e.ctx.performance={now:()=>0};
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

test('domicilio: correo completo rechazado, direcciones libres e historico conservado',async()=>{
    const e=editorPaciente();
    for (const valor of ['Av. San Martin 123 / 2-B','Ruta 8 km 40 s/n','Casa @ esquina','Barrio Norte']) {
        assert.equal(e.ctx.errorDomicilio(valor),null);
    }
    await e.ctx.abrir(paciente);
    e.form.elements.direccion.value='persona@example.com';await e.submit();
    assert.equal(e.calls.filter(c=>c.method==='patch').length,0);
    await e.ctx.abrir({...paciente,direccion:'historico@example.com'});
    e.form.elements.nombre.value='Otro';await e.submit();
    assert.deepEqual(e.calls.at(-1).data,{nombre:'Otro'});
});


test('H08: limites y formatos de campos modificados del paciente', async()=>{
    const invalidos = {nombre:['','   ','A'.repeat(101)], apellido:['',' '.repeat(3),'A'.repeat(101)],
        direccion:['','   ','A'.repeat(256)], numero_afiliado:['','   ','A'.repeat(21)],
        mail:['sin-arroba','a@','a@dominio','a'.repeat(39)+'@example.com'],
        cud_numero:['A'.repeat(21)], fecha_nacimiento:['','2099-01-01','2025-02-30'],
        cud_vencimiento:['2025-02-30'], obra_social:['']};
    invalidos.nombre.push('A'.repeat(61),'A'.repeat(101));
    invalidos.apellido.push('A'.repeat(61),'A'.repeat(101));
    for(const [campo,valores] of Object.entries(invalidos)) for(const valor of valores) {
        const e=editorPaciente();await e.ctx.abrir(paciente);e.form.elements[campo].value=valor;await e.submit();
        assert.equal(e.calls.filter(c=>c.method==='patch').length,0,`${campo}: ${valor}`);
        assert.equal(e.errors.length,1);
    }
    for(const [campo,valor] of Object.entries({nombre:'A'.repeat(60),apellido:'A'.repeat(60),
        direccion:'A'.repeat(255),numero_afiliado:'A'.repeat(20),cud_numero:'A'.repeat(20),
        mail:'a'.repeat(38)+'@example.com',cud_vencimiento:'2020-01-01',fecha_nacimiento:'2012-02-29'})) {
        const e=editorPaciente();await e.ctx.abrir({...paciente,cud_numero:'CUD',cud_vencimiento:'2027-01-01'});e.form.elements[campo].value=valor;await e.submit();
        assert.equal(e.calls.filter(c=>c.method==='patch').length,1,campo);
    }
});
test('H08: historicos intactos no se normalizan ni validan',async()=>{
    const e=editorPaciente();await e.ctx.abrir({...paciente,nombre:'   ',mail:'invalido',
        fecha_nacimiento:'2099-01-01',direccion:'A'.repeat(256),cud_numero:' '.repeat(30)});
    e.form.elements.apellido.value='Nuevo';await e.submit();
    assert.deepEqual(e.calls.at(-1).data,{apellido:'Nuevo'});
    const o=obras();o.ctx.get=async()=>[{id:11,nombre:'   ',mail:'invalido',web:'invalido',contacto:'x'.repeat(151)}];
    await o.open();await o.edit();o.node('os-nombre').value='Nuevo';await o.submit();
    assert.deepEqual(o.calls.find(c=>c.method==='patch').data,{nombre:'Nuevo'});
});
test('H08 H09: obra social valida alta y edicion antes del transporte',async()=>{
    for(const editar of [false,true]) for(const [campo,valor,ok] of [
        ['nombre','',false],['nombre','   ',false],['nombre','A'.repeat(150),true],['nombre','A'.repeat(151),false],
        ['contacto','A'.repeat(150),true],['contacto','A'.repeat(151),false],
        ['mail','a@example.com',true],['mail','a@dominio',false],['mail','sin-arroba',false],
        ['mail','a'.repeat(138)+'@example.com',true],['mail','a'.repeat(139)+'@example.com',false],
        ['web','https://example.com/'+ 'a'.repeat(235),true],['web','https://example.com/'+'a'.repeat(236),false],
        ['mail','a..b@example.com',false],['mail','a@-dominio.com',false],['web','example.com',false],['web','https://-dominio.com',false],['web','https://',false],['web','javascript:alert(1)',false],['web','https://example.com',true],
    ]) {
        const e=obras();await e.open();if(editar)await e.edit();else e.node('os-nombre').value='Nueva';
        e.node(`os-${campo}`).value=valor;await e.submit();
        assert.equal(e.calls.filter(c=>['post','patch'].includes(c.method)).length,ok?1:0,`${editar} ${campo} ${valor}`);
    }
});
test('H09: limites HTML coinciden con Backend',()=>{
    const base='SistemaEduGes/Frontend/templates/componentes/';
    assert.match(fs.readFileSync(base+'modal_nuevo_usuario.html','utf8'),/id="nuevo-usuario-nombre"[^>]*maxlength="100"/);
    assert.match(fs.readFileSync(base+'modal_obras_sociales.html','utf8'),/id="os-web"[^>]*maxlength="255"/);
});

test('H02 CUD: edicion final, borrado conjunto e historicos intactos',async()=>{
    for(const [original,cambios,ok] of [
        [paciente,{cud_numero:'N'},false], [paciente,{cud_vencimiento:'2027-01-01'},false],
        [paciente,{cud_numero:'N',cud_vencimiento:'2027-01-01'},true],
        [{...paciente,cud_numero:'N',cud_vencimiento:'2027-01-01'},{cud_numero:''},false],
        [{...paciente,cud_numero:'N',cud_vencimiento:'2027-01-01'},{cud_vencimiento:''},false],
        [{...paciente,cud_numero:'N',cud_vencimiento:'2027-01-01'},{cud_numero:'',cud_vencimiento:''},true],
        [{...paciente,cud_numero:'N'},{nombre:'Otro'},true],
        [{...paciente,cud_numero:'N'},{cud_numero:'Otro'},false],
        [{...paciente,cud_numero:'N'},{cud_vencimiento:'2027-01-01'},true],
    ]) {
        const e=editorPaciente();await e.ctx.abrir(original);
        for(const [campo,valor] of Object.entries(cambios)) e.form.elements[campo].value=valor;
        await e.submit();assert.equal(e.calls.filter(c=>c.method==='patch').length,ok?1:0,JSON.stringify(cambios));
        if(ok && cambios.nombre) assert.deepEqual(e.calls.at(-1).data,{nombre:'Otro'});
    }
    const e=editorPaciente();await e.ctx.abrir(paciente);
    e.form.elements.cud_vencimiento.validity={badInput:true};
    await e.submit();assert.equal(e.calls.filter(c=>c.method==='patch').length,0);
});

test('H08: dominios equivalentes a Django y opcionales vacios',()=>{
    const e=entorno();
    for(const [tipo,validos,invalidos] of [
        ['email',['a@mi-dominio.com','a@sub.mi-dominio.com','a@localhost','a@ejemplo.xn--p1ai','a@例子.公司'],
            ['a@example.c-','a@example.-com','a@-example.com','a@example-.com','a..b@example.com','sin-arroba']],
        ['url',['http://mi-dominio.com','https://sub.mi-dominio.com/ruta','https://example.com.','ftp://example.com','https://ejemplo.xn--p1ai'],
            ['https://example.-com','https://example.c-','http://-example.com','https://example-.com','https://','example.com']],
    ]) {
        for(const valor of [...validos,'','   ',null]) {
            assert.deepEqual(plain(e.ctx.validarCamposPreventivos({campo:valor},{campo:{tipo}})),{},String(valor));
        }
        for(const valor of invalidos) assert.ok(e.ctx.validarCamposPreventivos({campo:valor},{campo:{tipo}}).campo,valor);
    }
});

test('H08: fecha institucional independiente de zona y locale del navegador',()=>{
    for(const zona of ['America/Los_Angeles','Asia/Tokyo','UTC','America/Argentina/Buenos_Aires']) {
        for(const instante of ['2026-11-18T02:59:59Z','2026-11-18T03:00:00Z','2026-11-18T04:00:00Z']) {
            const e=entorno();
            const fechaReal = new Date(instante);
            const cliente = new Intl.DateTimeFormat('en-US',{timeZone:zona,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(fechaReal);
            const parte = tipo=>Number(cliente.find(p=>p.type===tipo).value);
            e.ctx.Date=class extends Date {
                constructor(...args){super(...(args.length?args:[instante]));}
                getFullYear(){return parte('year');}
                getMonth(){return parte('month')-1;}
                getDate(){return parte('day');}
            };
            // Si el código omite locale/zona explícitos, usa los del cliente simulado.
            e.ctx.Intl={DateTimeFormat:function(locale,options){
                return new Intl.DateTimeFormat(locale??'ar-EG',{timeZone:zona,...options});
            }};
            const validar=valor=>e.ctx.validarCamposPreventivos({fecha:valor},{fecha:{tipo:'nacimiento'}});
            assert.equal(Boolean(validar('2026-11-18').fecha),instante==='2026-11-18T02:59:59Z',`${zona} ${instante}`);
            assert.deepEqual(plain(validar('2026-11-17')),{});
            for(const valor of ['2026-11-19','2026-02-30','2026-13-01','texto']) assert.ok(validar(valor).fecha,valor);
            assert.deepEqual(plain(validar('2024-02-29')),{});
        }
    }
});


test('H14 H19: edicion conserva nombres intactos y no recorta DNI modificado',async()=>{
    const e=editorPaciente();await e.ctx.abrir({...paciente,nombre:'McDonald',apellido:"O'Neill"});
    e.form.elements.direccion.value='Otra direccion';await e.submit();
    assert.deepEqual(e.calls.at(-1).data,{direccion:'Otra direccion'});
    await e.ctx.abrir({...paciente,nombre:'McDonald',apellido:"O'Neill"});
    const antes=e.calls.filter(c=>c.method==='patch').length;
    e.form.elements.dni.value=' 1234567';await e.submit();
    assert.equal(e.calls.filter(c=>c.method==='patch').length,antes);
    e.form.elements.dni.value=paciente.dni;e.form.elements.nombre.value='DE LA CRUZ';await e.submit();
    assert.equal(e.calls.at(-1).data.nombre,'DE LA CRUZ');
});
