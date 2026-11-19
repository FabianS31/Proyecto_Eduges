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
        form.elements.mail.value='prueba@example.com';
        form.elements.cud_vencimiento.value='2027-01-01';
        form.elements.tutor_dni.value='20123456';
        form.elements.tutor_mail.value='tutor@example.com';
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

test('H02: movil opcional permite alta con los tres contactos obligatorios',async()=>{
    const e=entorno();e.form.elements.tutor_movil.value='';
    await e.submit();assert.equal(e.calls.length,1);
});

test('H02: telefono, correo y domicilio efectivo vacios bloquean alta',async()=>{
    for (const campo of ['tutor_telefono','tutor_mail','tutor_domicilio']) {
        for (const valor of ['', '   ']) {
            const e=entorno();e.form.elements[campo].value=valor;
            if (campo==='tutor_domicilio') e.form.elements.direccion.value='';
            await e.submit();assert.equal(e.calls.length,0);
        }
    }
});

test('H02: conserva domicilio del paciente como valor por defecto del tutor',async()=>{
    const e=entorno();e.form.elements.tutor_domicilio.value='';
    e.form.elements.direccion.value='Calle de prueba 123';
    await e.submit();assert.equal(e.calls.length,1);
    assert.equal(e.calls[0].tutor.domicilio,'Calle de prueba 123');
});

test('H02: correo informado invalido bloquea alta',async()=>{
    for(const malo of ['sin-arroba','a@dominio','a'.repeat(139)+'@example.com']) {
        const e=entorno();e.form.elements.tutor_mail.value=malo;
        await e.submit();assert.equal(e.calls.length,0,malo);
    }
    for(const [mail,ok] of [['',true],['a@dominio',false],['a'.repeat(38)+'@example.com',true],['a'.repeat(39)+'@example.com',false]]) {
        const e=entorno();e.form.elements.mail.value=mail;
        await e.submit();assert.equal(e.calls.length,ok?1:0,mail);
    }
});

test('Etapa2 alta paciente: limites y telefonos con signos internacionales',async()=>{
    const e1=entorno();e1.form.elements.direccion.value='A'.repeat(255);e1.form.elements.tutor_domicilio.value='B'.repeat(225);
    await e1.submit();assert.equal(e1.calls.length,1);

    const e2=entorno();e2.form.elements.direccion.value='A'.repeat(256);e2.form.elements.tutor_domicilio.value='B'.repeat(225);
    await e2.submit();assert.equal(e2.calls.length,0);

    const e3=entorno();e3.form.elements.numero_afiliado.value='A'.repeat(21);
    await e3.submit();assert.equal(e3.calls.length,0);

    const e4=entorno();
    e4.form.elements.tutor_telefono.value='+54 (011) 4444-5555';
    e4.form.elements.tutor_movil.value='+54 9 11 5555-6666';
    await e4.submit();assert.equal(e4.calls.length,1);

    const e5=entorno();e5.form.elements.tutor_telefono.value='1'.repeat(31);
    await e5.submit();assert.equal(e5.calls.length,0);

    const e6=entorno();e6.form.elements.tutor_movil.value='1'.repeat(31);
    await e6.submit();assert.equal(e6.calls.length,0);

    const manana = new Date(Date.now() + 2 * 86400000).toISOString().slice(0,10);
    const e7=entorno();e7.form.elements.fecha_nacimiento.value=manana;
    await e7.submit();assert.equal(e7.calls.length,0);
});

test('H02: HTML requiere telefono, correo y domicilio; movil opcional',()=>{
    const html=fs.readFileSync('SistemaEduGes/Frontend/templates/componentes/modal_paciente.html','utf8');
    for (const campo of ['mail','movil','domicilio','telefono']) {
        const input=html.match(new RegExp(`<input[^>]*name="tutor_${campo}"[^>]*>`))[0];
        assert.equal(/\brequired\b/.test(input),campo!=='movil');
    }
});

test('H20: copia 225, rechaza 226 y permite domicilio independiente sin truncar',async()=>{
    for(const largo of [225,226]) {
        const e=entorno();e.form.elements.direccion.value='A'.repeat(largo);e.form.elements.tutor_domicilio.value='';
        await e.submit();assert.equal(e.calls.length,largo===225?1:0);
        if(largo===225) assert.equal(e.calls[0].tutor.domicilio.length,225);
        else {
            assert.equal(e.form.elements.direccion.value.length,226);
            e.form.elements.tutor_domicilio.value='B'.repeat(225);await e.submit();
            assert.equal(e.calls.length,1);assert.equal(e.calls[0].direccion.length,226);
            assert.equal(e.calls[0].tutor.domicilio,'B'.repeat(225));
        }
    }
});

test('H02 CUD: alta opcional, pareja obligatoria, limites y fechas',async()=>{
    for(const [numero,fecha,ok] of [['','',true],['   ','',true],['A'.repeat(20),'2027-01-01',true],
        ['A','',false],['','2027-01-01',false],['A'.repeat(21),'2027-01-01',false],['A','2027-02-30',false]]) {
        const e=entorno();e.form.elements.cud_numero.value=numero;e.form.elements.cud_vencimiento.value=fecha;
        await e.submit();assert.equal(e.calls.length,ok?1:0,`${numero} ${fecha}`);
        if(ok && !numero.trim()) {
            assert.equal(e.calls[0].cud_numero,null);assert.equal(e.calls[0].cud_vencimiento,null);
        }
    }
    const e=entorno();e.form.elements.cud_numero.value='';e.form.elements.cud_vencimiento.value='';
    e.form.elements.cud_vencimiento.validity={badInput:true};
    await e.submit();assert.equal(e.calls.length,0);
});


test('H14 H19: alta integral preserva nombres y rechaza espacios en ambos DNI',async()=>{
    const e=entorno();await new Promise(r=>setImmediate(r));
    const ui=leer('ui.js');const start=ui.indexOf('export function capitalizar(');
    vm.runInContext(ui.slice(start,ui.indexOf('\n}',start)+2).replace('export ',''),e.ctx);
    e.form.elements.nombre.value='McDonald';e.form.elements.apellido.value="O'Neill";
    e.form.elements.tutor_nombre.value='DE LA CRUZ';e.form.elements.tutor_apellido.value="D'Angelo";
    for(const field of ['dni','tutor_dni']) {
        const previo=e.form.elements[field].value;e.form.elements[field].value=' 1234567';
        await e.submit();assert.equal(e.calls.length,0);e.form.elements[field].value=previo;
    }
    await e.submit();assert.equal(e.calls.length,1);
    assert.equal(e.calls[0].nombre,'McDonald');assert.equal(e.calls[0].apellido,"O'Neill");
    assert.equal(e.calls[0].tutor.nombre,'De La Cruz');assert.equal(e.calls[0].tutor.apellido,"D'Angelo");
});
