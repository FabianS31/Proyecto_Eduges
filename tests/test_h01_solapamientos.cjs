// Control preventivo real sobre datos ficticios, sin red ni navegador operativo.
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync('SistemaEduGes/Frontend/static/js/componentes/turnos.js','utf8');
const start=source.indexOf('function turnosQueSePisan('), end=source.indexOf('\n}',start)+2;
function conflictos(fecha,hora,turno,opciones={}) {
    const ctx=vm.createContext({turnosPorId:new Map([[1,{id_turno:1,profesional_id:1,paciente_id:1,estado:'Pendiente',...turno}]]),
        TURNO_DURACION_MINUTOS:40, minutosDe:h=>Number(h.slice(0,2))*60+Number(h.slice(3,5)),
        formatearHora:h=>h.slice(0,5),estaCancelado:t=>t.estado==='Cancelado'});
    vm.runInContext(source.slice(start,end),ctx);
    return ctx.turnosQueSePisan(fecha,hora,{profesional:1,paciente:1,...opciones}).length;
}
test('H01: calendario detecta intervalos en ambos sentidos y permite limites contiguos',()=>{
    for(const [f1,h1,f2,h2,n] of [
        ['2026-11-02','10:00','2026-11-02','10:00',1],
        ['2026-11-02','10:00','2026-11-02','10:39',1],
        ['2026-11-02','10:00','2026-11-02','10:40',0],
        ['2026-11-02','23:40','2026-11-03','00:00',1],
        ['2026-11-02','23:20','2026-11-03','00:00',0],
        ['2026-11-02','23:59','2026-11-03','00:10',1],
        ['2026-12-31','23:59','2027-01-01','00:10',1],
    ]) {
        assert.equal(conflictos(f1,h1,{fecha:f2,hora:h2}),n);
        assert.equal(conflictos(f2,h2,{fecha:f1,hora:h1}),n);
    }
});
test('H01: paciente o profesional, cancelados, ausentes y exclusion propia',()=>{
    const t={fecha:'2026-11-02',hora:'23:40'};
    for(const estado of ['Pendiente','Confirmado','Ausente','Realizado','Cancelado'])
        assert.equal(conflictos('2026-11-03','00:00',{...t,estado}),estado==='Cancelado'?0:1);
    assert.equal(conflictos('2026-11-03','00:00',{...t,paciente_id:2}),1);
    assert.equal(conflictos('2026-11-03','00:00',{...t,profesional_id:2}),1);
    assert.equal(conflictos('2026-11-03','00:00',{...t,profesional_id:2,paciente_id:2}),0);
    assert.equal(conflictos('2026-11-03','00:00',t,{excepto:1}),0);
});
test('H01: alta individual, multiple, anual y reprogramacion usan el control compartido',()=>{
    assert.match(source,/const choque = \(f, h\) => turnosQueSePisan/);
    assert.match(source,/generarFechasSemanales\(fInicio, 52\)/);
    assert.match(source,/excepto: turno.id_turno/);
});
