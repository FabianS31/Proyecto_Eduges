const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const leer=p=>fs.readFileSync('SistemaEduGes/Frontend/static/js/'+p,'utf8').replace(/\r/g,'');
const nombres=['McDonald',"O'Neill",'María José','Ana-María','DE LA CRUZ','Muñoz',"D'Angelo",'Ana','A'.repeat(100)];
const validos=['1234567','12345678'];
const invalidos=['123456','123456789','12.345.678','12-345-678','1234567²','１２３４５６７８','123A4567',' 1234567','1234567 '];
function entorno() {
    const handlers={},ctx=vm.createContext({});
    const emit=(nombre,target,extra={})=>{
        const e={target,cancelable:true,preventDefault(){this.cancelado=true;},stopImmediatePropagation(){this.detenido=true;},...extra};
        for(const fn of handlers[nombre]??[]) fn(e);
        return e;
    };
    class Input {
        constructor(value='',name='dni',maxLength=8){Object.assign(this,{value,name,maxLength,selectionStart:0,selectionEnd:value.length,error:'',reportes:0});}
        setCustomValidity(x){this.error=x;} reportValidity(){this.reportes++;return !this.error;}
        setRangeText(texto,a,b){this.value=this.value.slice(0,a)+texto+this.value.slice(b);this.selectionStart=this.selectionEnd=a+texto.length;}
        dispatchEvent(e){emit(e.type,this,e);}
    }
    Object.assign(ctx,{HTMLInputElement:Input,Event:class {constructor(type,options){Object.assign(this,{type},options);}},
        document:{addEventListener:(event,fn)=>(handlers[event]??=[]).push(fn)}});
    const fuente=leer('layout.js');const inicio=fuente.indexOf('function prepararInputsDni(');
    vm.runInContext(fuente.slice(inicio,fuente.indexOf('\nasync function iniciar()',inicio))+'\nprepararInputsDni();',ctx);
    return {emit,Input,ctx};
}

test('H14: escritura y presentacion conservan nombres, espacios internos y objeto original',()=>{
    const src=leer('ui.js'); const inicio=src.indexOf('export function capitalizar('), fin=src.indexOf('export function iniciales(');
    const c=vm.createContext({});vm.runInContext(src.slice(inicio,fin).replace(/export /g,''),c);
    for(const nombre of [...nombres,'María  José']) {
        assert.equal(c.capitalizar(` ${nombre} `),nombre);
        const persona={nombre,apellido:"O'Neill"},previo=JSON.stringify(persona);
        assert.equal(c.nombreCompleto(persona),`${nombre} O'Neill`);
        assert.equal(JSON.stringify(persona),previo);
    }
});

test('H19: pegado completo no truncado y submit bloqueado solo para invalido',()=>{
    for(const name of ['dni','tutor_dni']) for(const valor of [...validos,...invalidos]) {
        const {emit,Input}=entorno(),input=new Input('',name);emit('focusin',input);
        const paste=emit('paste',input,{clipboardData:{getData:()=>valor}});
        assert.equal(paste.cancelado,true);assert.equal(input.value,valor);
        assert.equal(Boolean(input.error),invalidos.includes(valor),valor);
        const submit=emit('submit',{elements:[input]});
        assert.equal(Boolean(submit.detenido),invalidos.includes(valor),valor);
    }
});

test('H19: teclado, beforeinput y autocompletado/input nunca limpian caracteres',()=>{
    for(const valor of [...validos,...invalidos]) {
        const {emit,Input}=entorno(),campo=new Input();emit('focusin',campo);
        const e=emit('beforeinput',campo,{data:valor,inputType:'insertText'});
        if(!e.cancelado){campo.value=valor;emit('input',campo,{inputType:'insertText'});}
        assert.equal(campo.value,valor);
        assert.equal(Boolean(campo.error),invalidos.includes(valor));
        const auto=new Input(valor);emit('input',auto,{inputType:'insertReplacementText'});
        assert.equal(auto.value,valor);assert.equal(Boolean(auto.error),invalidos.includes(valor));
    }
});

test('H19: historico intacto o revertido, seleccion parcial, correccion y reset',()=>{
    const {emit,Input}=entorno(),campo=new Input('HISTORICO','dni',20);
    emit('focusin',campo);emit('focusout',campo);
    assert.equal(emit('submit',{elements:[campo]}).detenido,undefined);
    campo.value='123';emit('input',campo);assert.ok(campo.error);
    campo.value='HISTORICO';emit('input',campo);assert.equal(campo.error,'');
    campo.value='12345678';emit('input',campo);assert.equal(campo.error,'');
    campo.selectionStart=3;campo.selectionEnd=5;
    emit('paste',campo,{clipboardData:{getData:()=>'.'}});
    assert.equal(campo.value,'123.678');assert.ok(campo.error);
    emit('reset',{elements:[campo]});assert.equal(campo.error,'');
});

test('H19: saltos de linea y clipboard inaccesible se rechazan sin fabricar otro DNI',()=>{
    for(const extra of [{clipboardData:{getData:()=> '123\n4567'}},{}]) {
        const {emit,Input}=entorno(),campo=new Input('12345678');emit('focusin',campo);
        emit('paste',campo,extra);assert.equal(campo.value,'12345678');assert.ok(campo.error);
        assert.ok(emit('submit',{elements:[campo]}).detenido);
        emit('input',campo);assert.equal(campo.error,'');
    }
});

test('H19: arrastre conserva texto y reapertura no arrastra errores a un historico',()=>{
    const {emit,Input}=entorno(),campo=new Input();emit('focusin',campo);
    emit('drop',campo,{dataTransfer:{getData:()=> '12.345.678'}});
    assert.equal(campo.value,'12.345.678');assert.ok(campo.error);
    emit('show.bs.modal',{querySelectorAll:()=>[campo]});
    campo.value='LEGADO';emit('focusin',campo);
    assert.equal(campo.error,'');assert.equal(emit('submit',{elements:[campo]}).detenido,undefined);
});

test('H14 H19: tutor adicional conserva nombres y edicion ajena los omite',()=>{
    const src=leer('paginas/pacientes.js'),ui=leer('ui.js');
    const campos={nombre:{value:'McDonald'},apellido:{value:"O'Neill"},dni:{value:'12345678'},
        parentesco_id:{value:'1'},telefono:{value:'123'},movil:{value:''},
        mail:{value:'ficticio@example.com',checkValidity:()=>true},domicilio:{value:'Ficticio'},tutor_id:{value:'1'}};
    const form={elements:campos,addEventListener:(n,f)=>c.submit=f};
    const c=vm.createContext({formAgregar:form,formEditar:form,estado:{fichaId:1},
        guardar:opts=>c.guardado=opts,tutores:{crear:datos=>c.enviado=datos,actualizar:(id,datos)=>c.enviado=datos},
        $:()=>({checked:false}),erroresAgregar:{},erroresEditar:{},modalAgregar(){},modalEditar(){},
        cargarTutoresFicha(){},errorDomicilio:()=>null,mailTutorOriginal:'ficticio@example.com',
        domicilioTutorOriginal:'Ficticio',nombresTutorOriginales:{nombre:'McDonald',apellido:"O'Neill"}});
    const inicio=ui.indexOf('export function capitalizar(');
    vm.runInContext(ui.slice(inicio,ui.indexOf('\n}',inicio)+2).replace('export ',''),c);
    for(const tipo of ['Agregar','Editar']) {
        const a=src.indexOf(`form${tipo}.addEventListener('submit'`);
        vm.runInContext(src.slice(a,src.indexOf('\n    });',a)+8),c);
        c.submit({preventDefault(){}});c.guardado.enviar();
        if(tipo==='Agregar') {
            assert.equal(c.enviado.nombre,'McDonald');assert.equal(c.enviado.apellido,"O'Neill");
            campos.dni.value=' 1234567';c.submit({preventDefault(){}});assert.ok(c.guardado.errores.dni);
        } else {
            assert.equal(c.enviado.nombre,undefined);assert.equal(c.enviado.apellido,undefined);
            campos.nombre.value='DE LA CRUZ';c.submit({preventDefault(){}});c.guardado.enviar();
            assert.equal(c.enviado.nombre,'DE LA CRUZ');
        }
    }
});
