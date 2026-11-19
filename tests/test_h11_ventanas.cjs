const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('SistemaEduGes/Frontend/static/js/componentes/turnos.js', 'utf8').replace(/\r/g, '');
const fechas = fs.readFileSync('SistemaEduGes/Frontend/static/js/fechas.js', 'utf8').replace(/export /g, '');
function funcion(nombre, indent = '') {
    const start = source.indexOf(`function ${nombre}(`);
    return source.slice(start, source.indexOf(`\n${indent}}`, start) + indent.length + 2);
}
function entorno(instante = '2027-03-01T15:00:00Z') {
    let reloj = instante;
    const nodes = new Map(), errores = [], llamadas = [];
    const $ = id => {
        if (!nodes.has(id)) nodes.set(id, {value:'', textContent:'', innerHTML:'', handlers:{},
            addEventListener(event, fn) {this.handlers[event] = fn;}});
        return nodes.get(id);
    };
    const c = vm.createContext({Intl, Date:class extends Date {
        constructor(...args) {super(...(args.length ? args : [reloj]));}
    }, $, console, formatearFecha:x=>x, formatearFechaLarga:x=>x,
    formulario:{elements:{fecha:{value:''}},addEventListener:(e,fn)=>c.submit=fn, reset(){}},
    modoAnual:()=>c.anual, modoVarios:()=>c.varios, anual:true, varios:false,
    calendario:{fechas:()=>c.fechasSeleccionadas,limpiar(){}},
    paciente:{valor:()=>1,limpiar(){}}, hora:{valor:()=>c.horaTexto,limpiar(){}}, horaTexto:'16:00',
    deProfesional:true,profesional:null,usuario:{profesional:{id:1}},usuarioActual:{},
    turnosQueSePisan:()=>[], nombreCompleto:()=> 'Ficticio', diaSemanaPlural:()=> 'lunes',
    TURNO_DURACION_MINUTOS:40, MENSAJE_HORA_INVALIDA:'Hora invalida', MENSAJE_HORA_PASADA:'Hora pasada',
    limpiarErroresFormulario(){},mostrarErroresFormulario:(f,e)=>errores.push(e.errores),
    ApiError:class {constructor(status,errores){this.errores=errores;}},
    obtenerModalNuevo:()=>({hide(){},show(){}}),
    window:{bootstrap:{Modal:{getOrCreateInstance:()=>({show(){}}),getInstance:()=>({hide(){}})}}},
    turnos:{crear:async cuerpo=>{llamadas.push(cuerpo);return []; }},
    botonCargando(){}, esProfesional:()=>false,notificar(){},notificarError(){},alCambiar:async()=>{},
    renderizar:(n,t)=>n.textContent=t,bloqueError:x=>x, erroresEnElCalendario:e=>{throw e;},
    });
    vm.runInContext(fechas, c);
    for (const fn of ['relojAgendamiento','fechaMaximaTurno','errorDeFecha','errorDeFechas','erroresFechaYHora','normalizarHora','sumarMinutos'])
        vm.runInContext(funcion(fn),c);
    vm.runInContext("const hoyAgendamiento=()=>relojAgendamiento().fecha; const minutosDe=h=>Number(h.slice(0,2))*60+Number(h.slice(3,5));",c);
    const a=source.indexOf('const horaYaPaso =');
    vm.runInContext(source.slice(a,source.indexOf('\n};',a)+3),c);
    vm.runInContext(funcion('generarFechasSemanales','    '),c);
    for (const marker of ["formulario.addEventListener('submit'", "$('btn-confirmar-agendar')?.addEventListener('click'"]) {
        const start=source.indexOf(marker);
        vm.runInContext(source.slice(start,source.indexOf('\n    });',start)+8),c);
    }
    return {c,$,errores,llamadas,reloj:x=>reloj=x,
        submit:()=>c.submit({preventDefault(){}}),confirmar:()=>$('btn-confirmar-agendar').handlers.click()};
}

test('H11: mismo limite inclusivo en cuatro zonas y años bisiestos',()=>{
    const anterior=process.env.TZ;
    try {
        for(const zona of ['UTC','Asia/Tokyo','America/Los_Angeles','America/Argentina/Buenos_Aires']) {
            process.env.TZ=zona;
            for(const [instante,hoy,maximo] of [
                ['2026-11-18T15:00:00Z','2026-11-18','2027-11-18'],
                ['2027-03-01T15:00:00Z','2027-03-01','2028-03-01'],
                ['2028-02-29T15:00:00Z','2028-02-29','2029-02-28'],
                ['2027-03-01T01:00:00Z','2027-02-28','2028-02-28'],
            ]) {
                const {c}=entorno(instante);
                assert.equal(c.relojAgendamiento().fecha,hoy,zona);
                assert.equal(c.fechaMaximaTurno(),maximo,zona);
                assert.equal(c.errorDeFecha(maximo),null);
                assert.ok(c.errorDeFecha(c.sumarDias(maximo,1)));
                assert.equal(vm.runInContext(`horaYaPaso('${hoy}', '00:00')`,c),true);
                const serie=c.generarFechasSemanales(hoy,52);
                assert.equal(serie.length,52);
                assert.equal(serie[51],c.sumarDias(hoy,357));
            }
        }
    } finally {if(anterior===undefined) delete process.env.TZ; else process.env.TZ=anterior;}
});

test('H11: 52 fechas completas; lote fuera de ventana no llega a confirmacion ni API',async()=>{
    for(const [inicio,valido] of [['2027-03-02',true],['2027-03-11',false],['2027-04-01',false]]) {
        const e=entorno();e.$('turno-fecha-inicio-anual').value=inicio;e.submit();
        if(valido) {
            assert.equal(e.errores.length,0);
            assert.equal(e.c.turnoPendienteDeConfirmar.cuerpo.turnos.length,52);
            assert.match(e.$('resumen-turno-horario').textContent,/16:00 a 16:40/);
            await e.confirmar();assert.equal(e.llamadas.length,1);
            assert.equal(e.llamadas[0].turnos.length,52);
        } else {
            assert.ok(e.errores[0].fecha_inicio_anual[0].includes('2028-03'));
            assert.equal(e.c.turnoPendienteDeConfirmar,undefined);
            assert.equal(e.llamadas.length,0);
        }
    }
});

test('H11: individual, multiple, destino reprogramado y formatos invalidos',()=>{
    const e=entorno();
    assert.deepEqual(Object.keys(e.c.erroresFechaYHora('2028-03-01','16:00','16:00',()=>[],1)),[]);
    assert.ok(e.c.erroresFechaYHora('2028-03-02','16:00','16:00',()=>[],1).fecha);
    for(const fecha of ['2027-02-30','malformada','']) assert.ok(e.c.errorDeFecha(fecha));
    for(const hora of ['25:00','12:99','malformada']) assert.ok(e.c.erroresFechaYHora('2027-03-02',e.c.normalizarHora(hora),hora,()=>[],1).hora);
    e.c.anual=false;e.c.varios=true;e.c.fechasSeleccionadas=['2027-03-02','2028-03-02'];e.submit();
    assert.ok(e.errores[0].turnos);
    assert.equal(e.llamadas.length,0);
});

test('H11: resumen abierto no envia fecha que paso a ser anterior al dia institucional',async()=>{
    const e=entorno();e.$('turno-fecha-inicio-anual').value='2027-03-01';e.submit();
    e.reloj('2027-03-02T04:00:00Z');await e.confirmar();
    assert.equal(e.llamadas.length,0);
    assert.match(e.$('confirmar-turno-error').textContent,/anterior a hoy/);
});

test('H11: botones de Inicio y Turnos usan limites institucionales y conservan permisos',()=>{
    for(const pagina of ['dashboard','turnos']) {
        const {c}=entorno('2027-03-01T01:00:00Z');
        const src=fs.readFileSync(`SistemaEduGes/Frontend/static/js/paginas/${pagina}.js`,'utf8').replace(/\r/g,'');
        const inicio=src.indexOf('function botonAgendar(');
        Object.assign(c,{estado:{usuario:{is_superuser:true}},PERMISO:{TURNOS_EDITAR:'crear'},
            tienePermiso:()=>true,html:()=> 'boton',icono:()=>'',diaEnTexto:x=>x});
        vm.runInContext(src.slice(inicio,src.indexOf('\n}',inicio)+2),c);
        assert.equal(c.botonAgendar('2027-02-28'),'boton');
        assert.equal(c.botonAgendar('2028-02-28'),'boton');
        assert.equal(c.botonAgendar('2028-02-29'),null);
        c.tienePermiso=()=>false;
        assert.equal(c.botonAgendar('2027-02-28'),null);
    }
});
