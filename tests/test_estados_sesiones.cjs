const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const src=fs.readFileSync('SistemaEduGes/Frontend/static/js/componentes/turnos.js','utf8');
const inicio=src.indexOf('function accionesTurno('), fin=src.indexOf('\n}',inicio)+2;
function acciones(diagnostico,pasado=true,estado=2){
 const ctx=vm.createContext({usuarioActual:{},ESTADO_TURNO:{PENDIENTE:1,CONFIRMADO:2,AUSENTE:5,REALIZADO:3},
  idEstado:t=>t.estado,puedeConfirmarTurno:()=>true,puedeMarcarAsistencia:()=>true,
  yaTermino:()=>pasado,yaEmpezo:()=>pasado,esProfesional:()=>true,esAdministrador:()=>false,
  tienePermiso:()=>false,PERMISO:{},puedeEditar:()=>true,estaActivo:()=>true,hoyISO:()=> '2026-11-12',
  boton:accion=>accion});
 vm.runInContext(src.slice(inicio,fin),ctx);
 return ctx.accionesTurno({diagnostico,estado,fecha:'2026-11-10'},'Prueba');
}
test('con sesion oculta ausente y conserva realizado manual',()=>{
 for(const d of ['Diagnostico','']){
  const a=acciones(d);assert.ok(!a.principales.includes('ausente'));assert.ok(a.principales.includes('realizado'));
 }
});
test('con sesion futura oculta cancelar y reprogramar',()=>{
 assert.equal(acciones('Diagnostico',false).secundarias.length,0);
});
test('sin sesion o sin informacion conserva acciones existentes',()=>{
 for(const d of [null,undefined]){
  assert.ok(acciones(d).principales.includes('ausente'));
  assert.ok(acciones(d,false).secundarias.includes('cancelar'));
 }
});
