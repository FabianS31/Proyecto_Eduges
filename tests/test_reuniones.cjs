const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('SistemaEduGes/Frontend/static/js/componentes/sesion-modal.js','utf8');
const start=src.indexOf("    $('sesion-insertar-reunion')?.addEventListener");
const handler=src.slice(start,src.indexOf('\n    });',start)+8);
const indicatorStart=src.indexOf('    function actualizarIndicadorReunion()');
const indicatorCode=src.slice(indicatorStart,src.indexOf('\n    }',indicatorStart)+6);
function entorno(overrides={}){
 const ctx={esAdmin:false,cargaValida:true,turnoActual:{id:1},modo:'creacion',
  trabajoInput:{value:'',focus(){}},btnGuardar:{disabled:false},...overrides};
 ctx.indicador={hidden:true};
 ctx.$=id=>id==='sesion-reunion-identificada'?ctx.indicador:{addEventListener:(event,fn)=>ctx.click=fn};
 vm.runInNewContext(indicatorCode,ctx);vm.runInNewContext(handler,ctx);return ctx;
}
test('plantilla solo prepara trabajo, sin peticiones ni sobrescrituras',()=>{
 const e=entorno();e.click();const texto=e.trabajoInput.value;
 for(const label of ['Reunión con padre/madre o tutor','Participante y vínculo','Modalidad','Temas tratados','Acuerdos y seguimiento'])assert.ok(texto.includes(label));
 e.click();assert.equal(e.trabajoInput.value,texto);
 e.trabajoInput.value='Contenido previo';e.click();assert.equal(e.trabajoInput.value,'Contenido previo');
});

test('reapertura reconoce texto guardado actual y anterior, sin clasificar texto comun',()=>{
 for(const encabezado of ['Reunión con tutor','Reunión con padre/madre o tutor']){
  const e=entorno({modo:'edicion'});e.trabajoInput.value=encabezado+'\nParticipante: Persona ficticia';
  e.actualizarIndicadorReunion();assert.equal(e.indicador.hidden,false);
  e.trabajoInput.value='Trabajo individual';e.actualizarIndicadorReunion();assert.equal(e.indicador.hidden,true);
 }
});
test('indicador no expone informacion al administrador ni queda al cerrar o fallar carga',()=>{
 for(const cambio of [{esAdmin:true},{cargaValida:false},{turnoActual:null}]){
  const e=entorno(cambio);e.trabajoInput.value='Reunión con tutor';e.actualizarIndicadorReunion();assert.equal(e.indicador.hidden,true);
 }
});
test('opcion visible sin desplegable y dentro de seccion clinica protegida',()=>{
 const html=fs.readFileSync('SistemaEduGes/Frontend/templates/componentes/modal_sesion.html','utf8');
 assert.ok(!html.includes('<details'));
 assert.ok(html.includes('class="btn btn-sm btn-outline-primary">Reunión con padre/madre o tutor</button>'));
 assert.ok(html.indexOf('sesion-insertar-reunion')>html.indexOf('sesion-seccion-trabajo'));
});
test('bloqueada para administrador, carga fallida, modal cerrado y guardado pendiente',()=>{
 for(const cambio of [{esAdmin:true},{cargaValida:false},{turnoActual:null},{modo:'lectura'},{btnGuardar:{disabled:true}}]){
  const e=entorno(cambio);e.click();assert.equal(e.trabajoInput.value,'');
 }
});
test('edicion vacia admite plantilla; diagnostico obligatorio se conserva',()=>{
 const e=entorno({modo:'edicion'});e.click();assert.ok(e.trabajoInput.value);
 assert.ok(src.includes('if (!datos.diagnostico)'));
 assert.ok(!handler.includes('diagnosticoInput'));
 assert.ok(!handler.includes('notaInput'));
});
test('agendamiento no ofrece controles ni confirmaciones de datos no persistidos',()=>{
 const js=fs.readFileSync('SistemaEduGes/Frontend/static/js/componentes/turnos.js','utf8');
 const html=fs.readFileSync('SistemaEduGes/Frontend/templates/componentes/modales_turno.html','utf8');
 for(const texto of [js,html])for(const id of ['turno-es-reunion','resumen-turno-modalidad','turno-tutor-campo'])assert.ok(!texto.includes(id));
 assert.ok(js.includes('turnos.crear(turnoPendienteDeConfirmar.cuerpo)'));
});
