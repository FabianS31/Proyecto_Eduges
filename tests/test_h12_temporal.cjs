const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('SistemaEduGes/Frontend/static/js/componentes/turnos.js','utf8').replace(/\r/g,'');
function funcion(nombre,indent='') {
    const a=src.indexOf(`function ${nombre}(`);
    return src.slice(a,src.indexOf(`\n${indent}}`,a)+indent.length+2);
}
function entorno() {
    let reloj=0;
    const turno={id_turno:1,fecha:'2027-03-01',hora:'12:10:00',referenciaTemporal:0,
        ventana_modificacion:{inicio:'2027-03-01T12:10:00-03:00',ahora:'2027-03-01T15:00:00Z'}};
    const errores=[],llamadas=[];
    const c=vm.createContext({Date,Number,Math,performance:{now:()=>reloj},turno,console,
        MENSAJE_ORIGINAL_INICIADO:'Ya llegó su hora de inicio.',
        ApiError:class extends Error {constructor(status,datos){super(datos.detail);this.status=status;}},
        nombrePaciente:()=> 'Ficticio',diaEnTexto:x=>x,formatearHora:x=>x.slice(0,5),
        html:(partes,...valores)=>partes.reduce((s,p,i)=>s+p+(valores[i]??''),''),
        confirmar:async()=>true,notificarError:e=>errores.push(e.message),notificar:()=>llamadas.push('exito'),
        turnos:{cancelar:async()=>llamadas.push('delete'),reprogramar:()=>llamadas.push('patch')},
        alCambiar:async()=>llamadas.push('recarga'),enfocarSiSePerdio(){},focoTrasCambio(){},
    });
    vm.runInContext(funcion('originalNoIniciado'),c);
    return {c,turno,errores,llamadas,avanzar:x=>reloj=x};
}

test('H12: límites estrictos, segundos, cambio de día y zonas del navegador',()=>{
    const anterior=process.env.TZ;
    try {
        for(const zona of ['UTC','Asia/Tokyo','America/Los_Angeles','America/Argentina/Buenos_Aires']) {
            process.env.TZ=zona;
            for(const segundos of [172800,600,1,0,-1]) {
                const e=entorno();
                e.turno.ventana_modificacion.inicio=new Date(Date.parse(e.turno.ventana_modificacion.ahora)+segundos*1000).toISOString();
                assert.equal(e.c.originalNoIniciado(e.turno),segundos>0);
            }
            const e=entorno();e.turno.ventana_modificacion={inicio:'2027-03-02T00:00:00-03:00',ahora:'2027-03-02T02:59:59Z'};
            assert.equal(e.c.originalNoIniciado(e.turno),true);
            e.avanzar(1000);assert.equal(e.c.originalNoIniciado(e.turno),false);
        }
    } finally {if(anterior===undefined)delete process.env.TZ;else process.env.TZ=anterior;}
});

test('H12: referencia del servidor, reloj local incorrecto y datos incompletos',()=>{
    const e=entorno();e.c.Date=class extends Date {static now(){return 0;}};
    assert.equal(e.c.originalNoIniciado(e.turno),true);
    e.avanzar(600000);assert.equal(e.c.originalNoIniciado(e.turno),false);
    assert.equal(e.c.originalNoIniciado({}),false);
});

test('H12: confirmación de cancelación abierta antes y aceptada al inicio no envía',async()=>{
    const e=entorno();
    vm.runInContext('async '+funcion('cancelar','    '),e.c);
    e.c.confirmar=async()=>{e.avanzar(600000);return true;};
    await e.c.cancelar(e.turno,{});
    assert.equal(e.llamadas.length,0);assert.match(e.errores[0],/hora de inicio/);
});

test('H12: cancelación válida y rechazo temporal del servidor mantienen mensajes',async()=>{
    for(const rechazo of [false,true]) {
        const e=entorno();vm.runInContext('async '+funcion('cancelar','    '),e.c);
        if(rechazo)e.c.turnos.cancelar=async()=>{throw new Error('El servidor indica que comenzó el turno');};
        await e.c.cancelar(e.turno,{});
        if(rechazo){assert.match(e.errores[0],/comenzó/);assert.equal(e.llamadas.length,0);}
        else assert.deepEqual(e.llamadas,['delete','exito','recarga']);
    }
});

test('H12: reprogramación revalida original al enviar y no altera el modal',()=>{
    for(const despues of [false,true]) {
        const e=entorno();let enviar,config;
        Object.assign(e.c,{
            formularioReprogramar:{elements:{fecha:{value:'2027-03-04'}},addEventListener:(ev,fn)=>enviar=fn},
            turnoAReprogramar:e.turno,horaReprogramar:{valor:()=> '18:00'},normalizarHora:x=>x,
            erroresFechaYHora:()=>({}),turnosQueSePisan:()=>[],alCerrar:()=>Promise.resolve(),modalReprogramar:{},
            $:()=>({}),guardar:datos=>config=datos,obtenerModalReprogramar:()=>({}),
        });
        const a=src.indexOf("formularioReprogramar.addEventListener('submit'");
        vm.runInContext(src.slice(a,src.indexOf('\n    });',a)+8),e.c);
        if(despues)e.avanzar(600000);
        enviar({preventDefault(){}});
        if(despues)assert.match(config.errores.detail[0],/hora de inicio/);
        else {assert.equal(Object.keys(config.errores).length,0);config.enviar();assert.deepEqual(e.llamadas,['patch']);}
        e.avanzar(600000);assert.throws(()=>config.enviar(),/hora de inicio/);
    }
});

test('H12: oculta acciones vencidas aun con modal abierto',async()=>{
    const e=entorno(),boton={dataset:{turno:'1'}};let tick;
    Object.assign(e.c,{document:{querySelectorAll:()=>[boton]},setInterval:fn=>tick=fn,
        turnosPorId:new Map([[1,e.turno]]),firmaDibujada:null});
    vm.runInContext(funcion('actualizarConLaHora'),e.c);
    e.c.actualizarConLaHora({zonas:()=>[],redibujar(){}});
    await tick();assert.equal(boton.disabled,undefined);
    e.avanzar(600000);await tick();assert.equal(boton.disabled,true);assert.equal(boton.hidden,true);
});

test('H12: caché conserva la referencia temporal original, sin reiniciar el plazo',async()=>{
    const endpoints=fs.readFileSync('SistemaEduGes/Frontend/static/js/endpoints.js','utf8');
    const a=endpoints.indexOf('async function listarTurnosConReloj(');
    let reloj=20;
    const c=vm.createContext({performance:{now:()=>reloj},api:{get:async()=>[{ventana_modificacion:{ahora:'2027-03-01T15:00:00Z'}}]}});
    vm.runInContext(endpoints.slice(a,endpoints.indexOf('\n}',a)+2),c);
    const lista=await c.listarTurnosConReloj();reloj=600020;
    assert.equal(lista[0].referenciaTemporal,20);
    assert.equal(lista[0].ventana_modificacion.ahora,'2027-03-01T15:00:00Z');
});
