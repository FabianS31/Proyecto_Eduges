const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = 'SistemaEduGes/Frontend/static/js/';
const leer = p => fs.readFileSync(root + p, 'utf8');
const codigo = s => s.replace(/^import[\s\S]*?;\s*$/gm, '').replace(/\bexport /g, '');

function entorno(rol = 'Profesional') {
    const nodes = new Map(), calls = [], consultas = [], errors = [], notices = [], saved = [];
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, {id, value:'', checked:false, disabled:false, hidden:false,
            dataset:{}, style:{}, handlers:{}, classList:{remove(){}},
            addEventListener(n,f){(this.handlers[n]??=[]).push(f);},
            async emit(n,e={}){for(const f of this.handlers[n]||[]) await f({preventDefault(){},...e});},
            focus(){}, querySelector(){return null;}, checkValidity(){return true;},
            reset(){Object.values(this.elements||{}).forEach(n=>{n.value='';n.checked=false;});}});
        return nodes.get(id);
    };
    const form = node('form-paciente');
    form.elements = {};
    const fields = ['nombre','apellido','dni','fecha_nacimiento','mail','direccion','obra_social',
        'numero_afiliado','cud_numero','cud_vencimiento','consentimiento','profesional',
        'tutor_nombre','tutor_apellido','tutor_dni','tutor_parentesco_id','tutor_telefono',
        'tutor_movil','tutor_mail','tutor_domicilio'];
    fields.forEach(k=>form.elements[k]=node(k));
    const modal = node('modal-paciente');
    const instance = {
        show(){modal.emit('show.bs.modal');},
        hide(){let cancelled=false; for(const f of modal.handlers['hide.bs.modal']||[]) f({preventDefault(){cancelled=true;}});
            if(!cancelled){modal.emit('hidden.bs.modal');this.closed++;} return !cancelled;}, closed:0,
    };
    const ctx = vm.createContext({console, document:{getElementById:node, activeElement:null},
        window:{bootstrap:{Modal:{getOrCreateInstance:()=>instance}}},
        hoyISO:()=> '2026-11-12', capitalizar:s=>s, coincideBusqueda:()=>true,
        buscarEnLista:()=>()=>[], crearCombobox:()=>({valor:()=>1,limpiar(){}}),
        obtenerUsuario:async()=>({rol:{nombre:rol}}),
        catalogos:{parentescos:async()=>[],obrasSociales:async()=>[]}, profesionales:{listar:async()=>[]},
        cargarParentescos:async()=>{}, // Catalogo probado por separado en etapa 7.
        tutores:{listar:async()=>[],crear:()=>{throw Error('No debe haber segunda peticion');}},
        pacientes:{crear:async d=>{calls.push(JSON.parse(JSON.stringify(d)));return ctx.reply();},
            comprobarAlta:async dni=>{consultas.push(dni);return ctx.check();}},
        reply:async()=>({id_paciente:40}),check:async()=>({paciente:null}),
        botonCargando:(b,v)=>{b.disabled=v;}, limpiarErroresFormulario(){},
        mostrarErroresFormulario:(f,e)=>{errors.push(e);return [e.message];},
        renderizar(){},html:()=>'',notificar:m=>notices.push(m),
    });
    vm.runInContext(codigo(leer('api.js')).split('// Utilidades')[0], ctx);
    vm.runInContext(codigo(leer('componentes/formularios.js')),ctx);
    vm.runInContext(codigo(leer('componentes/formulario-paciente.js')),ctx);
    ctx.saved = r=>saved.push(r);
    vm.runInContext('var abrir = prepararFormularioPaciente({alGuardar:saved}); abrir();',ctx);
    function llenar(){
        for(const field of fields) form.elements[field].value='Prueba';
        Object.assign(form.elements.dni,{value:'40123456'});
        form.elements.fecha_nacimiento.value='2010-01-01';
        form.elements.tutor_dni.value='20123456';
        form.elements.tutor_parentesco_id.value='37';
        form.elements.consentimiento.checked=true;
        form.elements.profesional.value='';
    }
    llenar();
    return {ctx,node,form,instance,calls,consultas,errors,notices,saved,llenar,
        submit:()=>form.emit('submit'),check:()=>node('btn-comprobar-alta-paciente').emit('click'),
        fail:status=>vm.runInContext(`reply = async()=>{throw new ApiError(${status});}`,ctx)};
}

test('una sola peticion con tutor principal; exito confirmado limpia formulario',async()=>{
    const e=entorno();await e.submit();assert.equal(e.calls.length,1);
    assert.equal(e.calls[0].tutor.responsable_principal,true);
    assert.equal(e.calls[0].tutor.parentesco_id,37);
    assert.equal(e.saved.length,1);assert.equal(e.notices.length,1);
    assert.equal(e.form.elements.dni.value,'');
    assert.equal(e.node('btn-comprobar-alta-paciente').hidden,true);
});

test('catalogo pendiente o fallido impide alta aunque quede un valor cargado',async()=>{
    const e=entorno();e.node('tutor-parentesco').disabled=true;
    await e.submit();assert.equal(e.calls.length,0);assert.equal(e.saved.length,0);
    e.node('tutor-parentesco').disabled=false;await e.submit();assert.equal(e.calls.length,1);
});

test('doble envio bloqueado y no permite cerrar mientras guarda',async()=>{
    const e=entorno();let resolve;e.ctx.reply=()=>new Promise(r=>resolve=r);
    const p=e.submit();await e.submit();assert.equal(e.calls.length,1);
    assert.equal(e.instance.hide(),false);resolve({id_paciente:40});await p;
    assert.equal(e.instance.closed,1);
});

test('conserva asignacion por rol: profesional implicito y administrador explicito',async()=>{
    for(const rol of ['Profesional','Administrador']){
        const e=entorno(rol);await new Promise(r=>setImmediate(r));
        e.form.elements.profesional.value='8';await e.submit();
        assert.equal(e.calls[0].profesional,rol==='Administrador'?8:undefined);
    }
});

test('respuesta perdida: no repite POST; cerrar/reabrir conserva solo la comprobacion explicita',async()=>{
    const e=entorno();e.fail(0);await e.submit();await e.submit();assert.equal(e.calls.length,1);
    assert.equal(e.saved.length,0);assert.equal(e.notices.length,0);
    assert.equal(e.node('btn-guardar-paciente').disabled,true);
    assert.equal(e.instance.hide(),true);e.instance.show();e.llenar();
    e.form.elements.dni.value='otro';await e.submit();assert.equal(e.calls.length,1);
    e.ctx.check=async()=>({paciente:{id_paciente:40}});await e.check();
    assert.deepEqual(e.consultas,['40123456']);assert.equal(e.saved.length,1);
    assert.equal(e.calls.length,1);
});

test('comprobacion sin resultado permite solo reintento manual',async()=>{
    const e=entorno();e.fail(0);await e.submit();await e.check();
    assert.equal(e.calls.length,1);assert.equal(e.node('btn-guardar-paciente').disabled,false);
    assert.equal(e.notices.length,0);e.ctx.reply=async()=>({id_paciente:40});
    await e.submit();assert.equal(e.calls.length,2);assert.equal(e.saved.length,1);
});

test('fallo de comprobacion mantiene bloqueo; no confunde error con ausencia',async()=>{
    const e=entorno();e.fail(0);await e.submit();e.ctx.check=async()=>{throw Error('red');};
    await e.check();assert.equal(e.node('btn-guardar-paciente').disabled,true);
    assert.equal(e.calls.length,1);assert.equal(e.saved.length,0);
});

test('500, timeout y respuesta exitosa ilegible requieren comprobacion',async()=>{
    for(const status of [500,408,null]){
        const e=entorno();if(status)e.fail(status);else e.ctx.reply=async()=>null;
        await e.submit();assert.equal(e.node('btn-guardar-paciente').disabled,true);
        assert.equal(e.notices.length,0);
    }
});

test('errores definitivos permiten corregir y no anuncian exito',async()=>{
    for(const status of [400,403]){
        const e=entorno();e.fail(status);await e.submit();
        assert.equal(e.node('btn-guardar-paciente').disabled,false);
        assert.equal(e.node('btn-comprobar-alta-paciente').hidden,true);
        assert.equal(e.form.elements.dni.value,'40123456');assert.equal(e.notices.length,0);
        e.instance.hide();e.instance.show();assert.equal(e.form.elements.dni.value,'');
    }
});

test('errores anidados de tutor corresponden a los campos existentes',async()=>{
    const e=entorno();vm.runInContext("reply=async()=>{throw new ApiError(400,{tutor:{mail:['Invalido']}});}",e.ctx);
    await e.submit();assert.ok(e.errors.at(-1).erroresDeCampo.tutor_mail);
});

test('comprobar usa GET sin cache y alta mantiene POST unico',async()=>{
    const calls=[];const ctx=vm.createContext({api:{get:async(...a)=>{calls.push(a);return {paciente:{id_paciente:1}};}},ESTADO_PACIENTE:{}});
    vm.runInContext(codigo(leer('endpoints.js')),ctx);
    await vm.runInContext("pacientes.comprobarAlta('40123456')",ctx);
    assert.equal(calls[0][0],'/pacientes/alta/resultado/');
    assert.equal(calls[0][1].parametros.dni,'40123456');
    assert.ok(!leer('componentes/formulario-paciente.js').includes('pacienteCreadoId'));
});

test('alta: rechaza correo como domicilio de paciente o tutor sin enviar',async()=>{
    for (const campo of ['direccion','tutor_domicilio']) {
        const e=entorno();e.form.elements[campo].value='persona@example.com';
        await e.submit();assert.equal(e.calls.length,0);assert.equal(e.notices.length,0);
        e.form.elements[campo].value='Ruta 8 km 40 / Casa B';
        await e.submit();assert.equal(e.calls.length,1);
    }
});
