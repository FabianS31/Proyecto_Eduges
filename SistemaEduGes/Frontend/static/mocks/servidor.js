// ============================================================
// EduGes - API simulada
// Responde las mismas rutas, con el mismo JSON y los mismos errores que
// describe docs/api-contrato.md. Se activa con CONFIG.USE_MOCKS = true y
// la usa api.js en lugar de fetch().
//
// - Los datos viven en memoria y se guardan en sessionStorage, así que
//   sobreviven a una recarga pero se pierden al cerrar la pestaña.
// - Arranca sin sesión: se entra por /login/ como con la API real. Con
//   CONFIG.MOCK_SESION_AUTOMATICA = true (atajo de desarrollo) se entra directo
//   con ?rol=admin o ?rol=profesional en la URL.
// - Desde la consola del navegador: edugesMock.reiniciar() vuelve a los datos iniciales.
// - Usuarios: admin, msoto, vmartinez, dfernandez, crios. Contraseña: demo1234
//
// Las decisiones abiertas del contrato (⚠️) se resolvieron acá de la forma más
// restrictiva: el Administrador no lee notas clínicas y el Profesional no da
// de alta pacientes. Si se decide otra cosa, cambiar PERMISOS_POR_ROL.
// ============================================================

import { CONFIG, obtenerRolMock, guardarRolMock } from '../js/config.js';
import {
    CUD_ESTADO,
    DIAS_AVISO_CUD,
    ESTADO_PACIENTE,
    ESTADO_TURNO,
    PERMISO,
    ROL,
    TRANSICIONES_TURNO,
} from '../js/constantes.js';
import { USUARIO_POR_ROL_MOCK, crearDatosIniciales, diasEntre, fechaISO, hoyISO } from './datos.js';

const CLAVE_ESTADO = 'eduges.mock.estado';

const PERMISOS_POR_ROL = {
    [ROL.ADMINISTRADOR]: [
        PERMISO.DASHBOARD_VER,
        PERMISO.PACIENTES_VER,
        PERMISO.PACIENTES_EDITAR,
        PERMISO.TURNOS_VER,
        PERMISO.TURNOS_EDITAR,
        PERMISO.PROFESIONALES_VER,
        PERMISO.PROFESIONALES_EDITAR,
        PERMISO.OBRAS_SOCIALES_EDITAR,
        PERMISO.USUARIOS_ADMIN,
    ],
    [ROL.PROFESIONAL]: [
        PERMISO.DASHBOARD_VER,
        PERMISO.PACIENTES_VER,
        PERMISO.TURNOS_VER,
        PERMISO.TURNOS_EDITAR,
        PERMISO.SESIONES_REGISTRAR,
        PERMISO.SESIONES_VER,
        PERMISO.PROFESIONALES_VER,
    ],
};

const MAX_INTENTOS_LOGIN = 5;
const BLOQUEO_LOGIN_SEG = 60;
const OBLIGATORIO = 'Este campo es obligatorio.';

// ============================================================
// Estado
// ============================================================
let db = null;

function nuevoEstado() {
    return {
        ...crearDatosIniciales(),
        sesion_usuario_id: null,
        rol_activo: null,
        intentos_fallidos: 0,
        bloqueado_hasta: 0,
    };
}

function cargarEstado() {
    const hoy = hoyISO();
    if (db && db.hoy === hoy) {
        return;
    }
    try {
        const guardado = JSON.parse(sessionStorage.getItem(CLAVE_ESTADO));
        // Los datos se calculan a partir de "hoy": si cambió el día se regeneran
        db = guardado && guardado.hoy === hoy ? guardado : nuevoEstado();
    } catch {
        db = nuevoEstado();
    }
}

function guardarEstado() {
    try {
        sessionStorage.setItem(CLAVE_ESTADO, JSON.stringify(db));
    } catch {
        // sessionStorage lleno o bloqueado: los cambios duran hasta recargar
    }
}

export function reiniciarMock() {
    db = null;
    try {
        sessionStorage.removeItem(CLAVE_ESTADO);
    } catch {
        // nada que borrar
    }
}

// Atajo de desarrollo (CONFIG.MOCK_SESION_AUTOMATICA): el rol elegido en la URL
// define con qué usuario se está "logueado", sin pasar por el login
function sincronizarSesion() {
    if (!CONFIG.MOCK_SESION_AUTOMATICA) {
        return;
    }
    const rol = obtenerRolMock();
    if (db.rol_activo !== rol) {
        db.rol_activo = rol;
        db.sesion_usuario_id = USUARIO_POR_ROL_MOCK[rol];
    }
}

if (typeof window !== 'undefined') {
    window.edugesMock = { reiniciar: reiniciarMock, estado: () => db };
}

// ============================================================
// Utilidades
// ============================================================
class ErrorHttp extends Error {
    constructor(status, cuerpo) {
        super(`HTTP ${status}`);
        this.status = status;
        this.cuerpo = cuerpo;
    }
}

const ok = (cuerpo) => ({ status: 200, cuerpo });
const creado = (cuerpo) => ({ status: 201, cuerpo });
const sinContenido = () => ({ status: 204, cuerpo: null });

const noEncontrado = (detalle = 'No encontrado.') => new ErrorHttp(404, { detail: detalle });
const sinPermiso = (detalle = 'No tenés permiso para realizar esta acción.') => new ErrorHttp(403, { detail: detalle });
const invalido = (errores) => new ErrorHttp(400, errores);
const conflicto = (detalle, codigo) => new ErrorHttp(409, { detail: detalle, codigo });

const hoy = () => db.hoy;
const siguienteId = (lista) => lista.reduce((max, item) => Math.max(max, item.id), 0) + 1;
const porId = (lista, id) => lista.find((item) => item.id === id) ?? null;
const catalogo = (nombre, id) => porId(db.catalogos[nombre], id);

function normalizar(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

function ahoraISO() {
    const ahora = new Date();
    const offset = -ahora.getTimezoneOffset();
    const signo = offset >= 0 ? '+' : '-';
    const dos = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
    const hora = `${dos(ahora.getHours())}:${dos(ahora.getMinutes())}:${dos(ahora.getSeconds())}`;
    return `${fechaISO(ahora)}T${hora}${signo}${dos(offset / 60)}:${dos(offset % 60)}`;
}

function paginar(items, query, ruta) {
    const tamanio = Math.min(Math.max(parseInt(query.page_size, 10) || 20, 1), 100);
    const pagina = query.page === undefined ? 1 : Number(query.page);
    const totalPaginas = Math.max(1, Math.ceil(items.length / tamanio));

    if (!Number.isInteger(pagina) || pagina < 1 || pagina > totalPaginas) {
        throw noEncontrado('Página inválida.');
    }

    const url = (n) => `${CONFIG.API_BASE}${ruta}?${new URLSearchParams({ ...query, page: String(n) })}`;
    return {
        count: items.length,
        next: pagina < totalPaginas ? url(pagina + 1) : null,
        previous: pagina > 1 ? url(pagina - 1) : null,
        results: items.slice((pagina - 1) * tamanio, pagina * tamanio),
    };
}

// ------------------------------------------------------------
// Validación de cuerpos (mensajes al estilo DRF, en español)
// ------------------------------------------------------------
class Validador {
    constructor(datos, parcial = false) {
        this.datos = datos && typeof datos === 'object' ? datos : {};
        this.parcial = parcial;
        this.errores = {};
        this.limpios = {};
    }

    error(campo, mensaje) {
        (this.errores[campo] ??= []).push(mensaje);
    }

    // Devuelve el valor crudo, o undefined si no hay que seguir validando
    leer(campo, { obligatorio = true, nulo = false, porDefecto } = {}) {
        if (!(campo in this.datos)) {
            if (this.parcial) {
                return undefined;
            }
            if (porDefecto !== undefined) {
                this.limpios[campo] = porDefecto;
            } else if (obligatorio) {
                this.error(campo, OBLIGATORIO);
            } else {
                this.limpios[campo] = null;
            }
            return undefined;
        }
        const valor = this.datos[campo];
        if (valor === null || valor === '') {
            if (nulo || !obligatorio) {
                this.limpios[campo] = null;
            } else {
                this.error(campo, valor === null ? 'Este campo no puede ser nulo.' : 'Este campo no puede estar en blanco.');
            }
            return undefined;
        }
        return valor;
    }

    texto(campo, { max, patron, mensajePatron, ...opciones } = {}) {
        const valor = this.leer(campo, opciones);
        if (valor === undefined) {
            return;
        }
        if (typeof valor !== 'string') {
            this.error(campo, 'Ingresá un texto válido.');
            return;
        }
        const limpio = valor.trim();
        if (!limpio) {
            this.error(campo, 'Este campo no puede estar en blanco.');
        } else if (max && limpio.length > max) {
            this.error(campo, `Asegurate de que este campo no tenga más de ${max} caracteres.`);
        } else if (patron && !patron.test(limpio)) {
            this.error(campo, mensajePatron);
        } else {
            this.limpios[campo] = limpio;
        }
    }

    fecha(campo, opciones = {}) {
        const valor = this.leer(campo, opciones);
        if (valor === undefined) {
            return;
        }
        const valida = typeof valor === 'string'
            && /^\d{4}-\d{2}-\d{2}$/.test(valor)
            && fechaISO(new Date(`${valor}T12:00:00`)) === valor;
        if (valida) {
            this.limpios[campo] = valor;
        } else {
            this.error(campo, 'Fecha con formato erróneo. Usá AAAA-MM-DD.');
        }
    }

    hora(campo, opciones = {}) {
        const valor = this.leer(campo, opciones);
        if (valor === undefined) {
            return;
        }
        const partes = typeof valor === 'string' ? valor.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/) : null;
        if (partes) {
            this.limpios[campo] = `${partes[1]}:${partes[2]}:${partes[3] ?? '00'}`;
        } else {
            this.error(campo, 'Hora con formato erróneo. Usá hh:mm.');
        }
    }

    booleano(campo, opciones = {}) {
        const valor = this.leer(campo, opciones);
        if (valor === undefined) {
            return;
        }
        if (typeof valor === 'boolean') {
            this.limpios[campo] = valor;
        } else {
            this.error(campo, 'Debe ser verdadero o falso.');
        }
    }

    referencia(campo, lista, opciones = {}) {
        const valor = this.leer(campo, opciones);
        if (valor === undefined) {
            return;
        }
        if (Number.isInteger(valor) && porId(lista, valor)) {
            this.limpios[campo] = valor;
        } else {
            this.error(campo, `Clave primaria "${valor}" inválida - objeto no existe.`);
        }
    }

    password(campo) {
        const valor = this.leer(campo);
        if (valor === undefined) {
            return;
        }
        if (typeof valor !== 'string' || valor.length < 8) {
            this.error(campo, 'La contraseña debe tener al menos 8 caracteres.');
        } else {
            this.limpios[campo] = valor;
        }
    }

    get hayErrores() {
        return Object.keys(this.errores).length > 0;
    }

    terminar() {
        if (this.hayErrores) {
            throw invalido(this.errores);
        }
        return this.limpios;
    }
}

const PATRON_DNI = /^\d{7,8}$/;
const MENSAJE_DNI = 'El DNI debe tener 7 u 8 dígitos, sin puntos.';
const PATRON_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MENSAJE_MAIL = 'Ingresá un mail válido.';

// ============================================================
// Autenticación y permisos
// ============================================================
function usuarioActual() {
    const usuario = porId(db.usuarios, db.sesion_usuario_id);
    if (!usuario) {
        throw new ErrorHttp(401, { detail: 'Las credenciales de autenticación no se proveyeron.' });
    }
    return usuario;
}

const permisosDe = (usuario) => PERMISOS_POR_ROL[usuario.rol_id] ?? [];

// Devuelve el contexto de quien hace la request; lanza 401/403 si corresponde
function contexto(permiso) {
    const usuario = usuarioActual();
    if (permiso && !permisosDe(usuario).includes(permiso)) {
        throw sinPermiso();
    }
    return {
        usuario,
        admin: usuario.rol_id === ROL.ADMINISTRADOR,
        profesional: db.profesionales.find((p) => p.usuario_id === usuario.id) ?? null,
    };
}

const asignacionVigente = (a) => a.fecha_fin === null || a.fecha_fin >= hoy();

function pacienteVisible(ctx, paciente) {
    if (ctx.admin) {
        return true;
    }
    return Boolean(ctx.profesional) && db.asignaciones.some((a) =>
        a.paciente_id === paciente.id && a.profesional_id === ctx.profesional.id && asignacionVigente(a));
}

const turnoVisible = (ctx, turno) => ctx.admin || (Boolean(ctx.profesional) && turno.profesional_id === ctx.profesional.id);

function pacienteParaCtx(ctx, id) {
    const paciente = porId(db.pacientes, id);
    if (!paciente || !pacienteVisible(ctx, paciente)) {
        throw noEncontrado();
    }
    return paciente;
}

function turnoParaCtx(ctx, id) {
    const turno = porId(db.turnos, id);
    if (!turno || !turnoVisible(ctx, turno)) {
        throw noEncontrado();
    }
    return turno;
}

// ============================================================
// Serialización (tablas → JSON del contrato)
// ============================================================
function infoCud(paciente) {
    const dias = diasEntre(hoy(), paciente.cud_vencimiento);
    let estado = CUD_ESTADO.VIGENTE;
    if (dias < 0) {
        estado = CUD_ESTADO.VENCIDO;
    } else if (dias <= DIAS_AVISO_CUD) {
        estado = CUD_ESTADO.POR_VENCER;
    }
    return { dias, estado };
}

function edad(fechaNacimiento) {
    const actual = hoy();
    let anios = Number(actual.slice(0, 4)) - Number(fechaNacimiento.slice(0, 4));
    if (actual.slice(5) < fechaNacimiento.slice(5)) {
        anios -= 1;
    }
    return anios;
}

function obraSocialCorta(id) {
    const os = porId(db.obras_sociales, id);
    return os ? { id: os.id, nombre: os.nombre } : null;
}

const profesionalCorto = (p) => (p ? { id: p.id, nombre: p.nombre, apellido: p.apellido } : null);

function tutorJson(tutor) {
    const { id, nombre, apellido, telefono_fijo, telefono_movil, mail } = tutor;
    return { id, nombre, apellido, telefono_fijo, telefono_movil, mail };
}

function vinculoJson(vinculo) {
    return {
        vinculo_id: vinculo.id,
        tutor: tutorJson(porId(db.tutores, vinculo.tutor_id)),
        parentesco: catalogo('parentescos', vinculo.parentesco_id),
        responsable_principal: vinculo.responsable_principal,
    };
}

function tutorPrincipal(pacienteId) {
    const vinculos = db.vinculos.filter((v) => v.paciente_id === pacienteId);
    const vinculo = vinculos.find((v) => v.responsable_principal) ?? vinculos[0];
    if (!vinculo) {
        return null;
    }
    const tutor = porId(db.tutores, vinculo.tutor_id);
    return { nombre: `${tutor.nombre} ${tutor.apellido}`, telefono_movil: tutor.telefono_movil ?? tutor.telefono_fijo };
}

function pacienteResumenJson(p) {
    const cud = infoCud(p);
    return {
        id: p.id,
        nombre: p.nombre,
        apellido: p.apellido,
        dni: p.dni,
        edad: edad(p.fecha_nacimiento),
        obra_social: obraSocialCorta(p.obra_social_id),
        estado: catalogo('estados_pacientes', p.estado_id),
        cud_vencimiento: p.cud_vencimiento,
        cud_estado: cud.estado,
        tutor_principal: tutorPrincipal(p.id),
    };
}

function pacienteDetalleJson(p) {
    return {
        id: p.id,
        nombre: p.nombre,
        apellido: p.apellido,
        dni: p.dni,
        fecha_nacimiento: p.fecha_nacimiento,
        edad: edad(p.fecha_nacimiento),
        direccion: p.direccion,
        consentimiento: p.consentimiento,
        cud_vencimiento: p.cud_vencimiento,
        cud_estado: infoCud(p).estado,
        obra_social: obraSocialCorta(p.obra_social_id),
        numero_afiliado: p.numero_afiliado,
        estado: catalogo('estados_pacientes', p.estado_id),
        tutores: db.vinculos.filter((v) => v.paciente_id === p.id).map(vinculoJson),
        profesionales_asignados: db.asignaciones
            .filter((a) => a.paciente_id === p.id && asignacionVigente(a))
            .map((a) => ({
                asignacion_id: a.id,
                profesional: profesionalCorto(porId(db.profesionales, a.profesional_id)),
                fecha_inicio: a.fecha_inicio,
                fecha_fin: a.fecha_fin,
            })),
    };
}

function turnoJson(t) {
    const paciente = porId(db.pacientes, t.paciente_id);
    return {
        id: t.id,
        fecha: t.fecha,
        hora_inicio: t.hora_inicio,
        hora_fin: t.hora_fin,
        estado: catalogo('estados_turnos', t.estado_id),
        paciente: {
            id: paciente.id,
            nombre: paciente.nombre,
            apellido: paciente.apellido,
            dni: paciente.dni,
            obra_social: obraSocialCorta(paciente.obra_social_id),
            cud_estado: infoCud(paciente).estado,
        },
        profesional: profesionalCorto(porId(db.profesionales, t.profesional_id)),
        tiene_registro_sesion: t.registro_sesion_id !== null,
    };
}

function registroJson(turno, registro) {
    return {
        turno_id: turno.id,
        nota_clinica: registro.nota_clinica,
        autor: profesionalCorto(porId(db.profesionales, registro.autor_id)),
        creado: registro.creado,
        modificado: registro.modificado,
    };
}

function profesionalJson(p, ctx) {
    const usuario = porId(db.usuarios, p.usuario_id);
    const json = {
        id: p.id,
        nombre: p.nombre,
        apellido: p.apellido,
        dni: p.dni,
        matricula: p.matricula,
        especialidad: catalogo('especialidades', p.especialidad_id),
        contacto: p.contacto,
        mail: p.mail,
        estado: catalogo('estados_profesionales', p.estado_id),
        usuario: usuario ? { id: usuario.id, usuario: usuario.usuario } : null,
        pacientes_asignados: db.asignaciones.filter((a) => a.profesional_id === p.id && asignacionVigente(a)).length,
    };
    // Un profesional no ve el DNI ni el usuario de sus colegas
    if (!ctx.admin && ctx.profesional?.id !== p.id) {
        delete json.dni;
        delete json.usuario;
    }
    return json;
}

function asignacionJson(a) {
    const paciente = porId(db.pacientes, a.paciente_id);
    return {
        id: a.id,
        paciente: { id: paciente.id, nombre: paciente.nombre, apellido: paciente.apellido },
        profesional: profesionalCorto(porId(db.profesionales, a.profesional_id)),
        fecha_inicio: a.fecha_inicio,
        fecha_fin: a.fecha_fin,
        vigente: asignacionVigente(a),
    };
}

function obraSocialJson(os) {
    return {
        id: os.id,
        nombre: os.nombre,
        contacto: os.contacto,
        mail: os.mail,
        web: os.web,
        tipo: catalogo('tipos_obras_sociales', os.tipo_id),
        estado: catalogo('estados_obras_sociales', os.estado_id),
    };
}

function usuarioJson(u) {
    return {
        id: u.id,
        usuario: u.usuario,
        rol: catalogo('roles', u.rol_id),
        profesional: profesionalCorto(db.profesionales.find((p) => p.usuario_id === u.id)),
    };
}

function meJson(u) {
    const profesional = db.profesionales.find((p) => p.usuario_id === u.id);
    return {
        id: u.id,
        usuario: u.usuario,
        rol: catalogo('roles', u.rol_id),
        profesional: profesional
            ? {
                id: profesional.id,
                nombre: profesional.nombre,
                apellido: profesional.apellido,
                especialidad: catalogo('especialidades', profesional.especialidad_id),
            }
            : null,
        permisos: [...permisosDe(u)],
    };
}

// ============================================================
// §3 Autenticación
// ============================================================
function authCsrf() {
    return sinContenido();
}

function authLogin({ cuerpo }) {
    const restante = Math.ceil((db.bloqueado_hasta - Date.now()) / 1000);
    if (restante > 0) {
        throw new ErrorHttp(429, {
            detail: 'Demasiados intentos fallidos. Esperá un momento y volvé a intentar.',
            reintentar_en: restante,
        });
    }

    const v = new Validador(cuerpo);
    v.texto('usuario');
    v.leer('password');
    v.booleano('recordar', { porDefecto: false });
    v.terminar();

    const usuario = db.usuarios.find((u) => u.usuario === cuerpo.usuario.trim());
    if (!usuario || usuario.password !== cuerpo.password) {
        db.intentos_fallidos += 1;
        if (db.intentos_fallidos >= MAX_INTENTOS_LOGIN) {
            db.intentos_fallidos = 0;
            db.bloqueado_hasta = Date.now() + BLOQUEO_LOGIN_SEG * 1000;
        }
        throw invalido({ non_field_errors: ['Usuario o contraseña incorrectos.'] });
    }

    const rol = usuario.rol_id === ROL.ADMINISTRADOR ? 'admin' : 'profesional';
    db.intentos_fallidos = 0;
    db.sesion_usuario_id = usuario.id;
    db.rol_activo = rol;
    guardarRolMock(rol);
    return ok(meJson(usuario));
}

function authLogout() {
    db.sesion_usuario_id = null;
    return sinContenido();
}

function authMe() {
    return ok(meJson(usuarioActual()));
}

function authCambiarPassword({ cuerpo }) {
    const usuario = usuarioActual();
    const v = new Validador(cuerpo);
    v.leer('password_actual');
    v.password('password_nuevo');
    v.leer('password_nuevo_confirmacion');

    if (!v.errores.password_actual && cuerpo.password_actual !== usuario.password) {
        v.error('password_actual', 'La contraseña actual es incorrecta.');
    }
    if (!v.errores.password_nuevo_confirmacion && cuerpo.password_nuevo_confirmacion !== cuerpo.password_nuevo) {
        v.error('password_nuevo_confirmacion', 'Las contraseñas no coinciden.');
    }
    v.terminar();

    usuario.password = cuerpo.password_nuevo;
    return sinContenido();
}

// ============================================================
// §4 Catálogos
// ============================================================
function catalogosObtener() {
    usuarioActual();
    const c = db.catalogos;
    return ok({
        estados_turnos: c.estados_turnos,
        estados_pacientes: c.estados_pacientes,
        estados_profesionales: c.estados_profesionales,
        especialidades: c.especialidades,
        parentescos: c.parentescos,
        tipos_obras_sociales: c.tipos_obras_sociales,
        estados_obras_sociales: c.estados_obras_sociales,
        obras_sociales: db.obras_sociales
            .filter((os) => os.estado_id === 1)
            .map((os) => ({ id: os.id, nombre: os.nombre }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre)),
        roles: c.roles,
    });
}

// ============================================================
// §5 Dashboard
// ============================================================
function dashboardResumen({ query }) {
    const ctx = contexto(PERMISO.DASHBOARD_VER);
    const v = new Validador(query);
    v.fecha('fecha', { porDefecto: hoy() });
    const { fecha } = v.terminar();

    const turnosDelDia = db.turnos.filter((t) => t.fecha === fecha && turnoVisible(ctx, t));
    const contar = (estadoId) => turnosDelDia.filter((t) => t.estado_id === estadoId).length;
    const pacientesActivos = db.pacientes.filter((p) => p.estado_id === ESTADO_PACIENTE.ACTIVO && pacienteVisible(ctx, p));

    return ok({
        fecha,
        turnos: {
            total: turnosDelDia.length,
            pendientes: contar(ESTADO_TURNO.PENDIENTE),
            confirmados: contar(ESTADO_TURNO.CONFIRMADO),
            realizados: contar(ESTADO_TURNO.REALIZADO),
            cancelados: contar(ESTADO_TURNO.CANCELADO),
        },
        pacientes_activos: pacientesActivos.length,
        profesionales_activos: ctx.admin ? db.profesionales.filter((p) => p.estado_id === 1).length : null,
        alertas_cud: pacientesActivos.filter((p) => infoCud(p).dias <= DIAS_AVISO_CUD).length,
    });
}

// ============================================================
// §6 Pacientes
// ============================================================
const ORDEN_PACIENTES = {
    apellido: (a, b) => a.apellido.localeCompare(b.apellido) || a.nombre.localeCompare(b.nombre),
    '-apellido': (a, b) => b.apellido.localeCompare(a.apellido) || b.nombre.localeCompare(a.nombre),
    cud_vencimiento: (a, b) => a.cud_vencimiento.localeCompare(b.cud_vencimiento),
    '-cud_vencimiento': (a, b) => b.cud_vencimiento.localeCompare(a.cud_vencimiento),
};

function pacientesListar({ query }) {
    const ctx = contexto(PERMISO.PACIENTES_VER);
    const orden = ORDEN_PACIENTES[query.ordering ?? 'apellido'];
    if (!orden) {
        throw invalido({ ordering: [`Orden inválido. Opciones: ${Object.keys(ORDEN_PACIENTES).join(', ')}.`] });
    }

    let lista = db.pacientes.filter((p) => pacienteVisible(ctx, p));

    if (query.q) {
        const q = normalizar(query.q);
        lista = lista.filter((p) => normalizar(`${p.nombre} ${p.apellido} ${p.dni} ${p.apellido} ${p.nombre}`).includes(q));
    }
    if (query.estado) {
        lista = lista.filter((p) => p.estado_id === Number(query.estado));
    }
    if (query.profesional && ctx.admin) {
        const profesionalId = Number(query.profesional);
        lista = lista.filter((p) => db.asignaciones.some((a) =>
            a.paciente_id === p.id && a.profesional_id === profesionalId && asignacionVigente(a)));
    }
    if (query.obra_social) {
        lista = lista.filter((p) => p.obra_social_id === Number(query.obra_social));
    }
    if (query.cud_estado) {
        lista = lista.filter((p) => infoCud(p).estado === query.cud_estado);
    }

    return ok(paginar([...lista].sort(orden).map(pacienteResumenJson), query, '/pacientes/'));
}

function pacientesObtener({ params: [id] }) {
    const ctx = contexto(PERMISO.PACIENTES_VER);
    return ok(pacienteDetalleJson(pacienteParaCtx(ctx, id)));
}

function validarPaciente(cuerpo, parcial, idActual = null) {
    const v = new Validador(cuerpo, parcial);
    v.texto('nombre', { max: 100 });
    v.texto('apellido', { max: 100 });
    v.texto('dni', { patron: PATRON_DNI, mensajePatron: MENSAJE_DNI });
    v.fecha('fecha_nacimiento');
    v.texto('direccion', { max: 255 });
    v.booleano('consentimiento');
    v.fecha('cud_vencimiento');
    v.referencia('obra_social_id', db.obras_sociales);
    v.texto('numero_afiliado', { max: 20 });
    v.referencia('estado_id', db.catalogos.estados_pacientes, { porDefecto: ESTADO_PACIENTE.ACTIVO });

    const datos = v.limpios;
    if (datos.fecha_nacimiento && datos.fecha_nacimiento > hoy()) {
        v.error('fecha_nacimiento', 'La fecha de nacimiento no puede ser futura.');
    }
    if (datos.obra_social_id && porId(db.obras_sociales, datos.obra_social_id).estado_id !== 1) {
        v.error('obra_social_id', 'La obra social está dada de baja.');
    }
    v.terminar();

    if (datos.dni && db.pacientes.some((p) => p.dni === datos.dni && p.id !== idActual)) {
        throw conflicto('Ya existe un paciente con ese DNI.', 'dni_duplicado');
    }
    return datos;
}

function pacientesCrear({ cuerpo }) {
    contexto(PERMISO.PACIENTES_EDITAR);
    const datos = validarPaciente(cuerpo, false);
    const paciente = { id: siguienteId(db.pacientes), ...datos };
    db.pacientes.push(paciente);
    return creado(pacienteDetalleJson(paciente));
}

function pacientesActualizar({ params: [id], cuerpo }) {
    contexto(PERMISO.PACIENTES_EDITAR);
    const paciente = porId(db.pacientes, id);
    if (!paciente) {
        throw noEncontrado();
    }
    Object.assign(paciente, validarPaciente(cuerpo, true, id));
    return ok(pacienteDetalleJson(paciente));
}

function pacientesCudPorVencer({ query }) {
    const ctx = contexto(PERMISO.PACIENTES_VER);
    const dias = query.dias === undefined ? DIAS_AVISO_CUD : Number(query.dias);
    const limite = query.limite === undefined ? null : Number(query.limite);
    if (!Number.isInteger(dias) || dias < 0) {
        throw invalido({ dias: ['Ingresá un número entero mayor o igual a 0.'] });
    }
    if (limite !== null && (!Number.isInteger(limite) || limite < 1)) {
        throw invalido({ limite: ['Ingresá un número entero mayor a 0.'] });
    }

    let lista = db.pacientes
        .filter((p) => p.estado_id === ESTADO_PACIENTE.ACTIVO && pacienteVisible(ctx, p) && infoCud(p).dias <= dias)
        .sort((a, b) => a.cud_vencimiento.localeCompare(b.cud_vencimiento));
    if (limite !== null) {
        lista = lista.slice(0, limite);
    }

    return ok(lista.map((p) => {
        const cud = infoCud(p);
        return {
            id: p.id,
            nombre: p.nombre,
            apellido: p.apellido,
            cud_vencimiento: p.cud_vencimiento,
            cud_estado: cud.estado,
            dias_restantes: cud.dias,
            tutor_principal: tutorPrincipal(p.id),
        };
    }));
}

// ------------------------------------------------------------
// Tutores
// ------------------------------------------------------------
function validarTutor(cuerpo, parcial) {
    const v = new Validador(cuerpo, parcial);
    v.texto('nombre', { max: 100 });
    v.texto('apellido', { max: 100 });
    v.texto('telefono_fijo', { max: 30, obligatorio: false });
    v.texto('telefono_movil', { max: 30, obligatorio: false });
    v.texto('mail', { max: 150, obligatorio: false, patron: PATRON_MAIL, mensajePatron: MENSAJE_MAIL });
    return v;
}

function desmarcarOtrosPrincipales(vinculo) {
    for (const otro of db.vinculos) {
        if (otro.paciente_id === vinculo.paciente_id && otro.id !== vinculo.id) {
            otro.responsable_principal = false;
        }
    }
}

function vinculoDelPaciente(pacienteId, vinculoId) {
    const vinculo = db.vinculos.find((x) => x.id === vinculoId && x.paciente_id === pacienteId);
    if (!vinculo) {
        throw noEncontrado();
    }
    return vinculo;
}

function tutoresDelPacienteListar({ params: [pacienteId] }) {
    const ctx = contexto(PERMISO.PACIENTES_VER);
    pacienteParaCtx(ctx, pacienteId);
    return ok(db.vinculos.filter((v) => v.paciente_id === pacienteId).map(vinculoJson));
}

function tutoresDelPacienteVincular({ params: [pacienteId], cuerpo }) {
    const ctx = contexto(PERMISO.PACIENTES_EDITAR);
    pacienteParaCtx(ctx, pacienteId);

    const v = new Validador(cuerpo);
    v.referencia('parentesco_id', db.catalogos.parentescos);
    v.booleano('responsable_principal', { porDefecto: false });

    let datosTutor = null;
    if (cuerpo.tutor && typeof cuerpo.tutor === 'object') {
        const vTutor = validarTutor(cuerpo.tutor, false);
        if (vTutor.hayErrores) {
            v.errores.tutor = vTutor.errores;
        }
        datosTutor = vTutor.limpios;
    } else {
        v.referencia('tutor_id', db.tutores);
    }
    const datos = v.terminar();

    let tutorId = datos.tutor_id;
    if (datosTutor) {
        tutorId = siguienteId(db.tutores);
        db.tutores.push({ id: tutorId, ...datosTutor });
    } else if (db.vinculos.some((x) => x.paciente_id === pacienteId && x.tutor_id === tutorId)) {
        throw conflicto('Ese tutor ya está vinculado al paciente.', 'tutor_ya_vinculado');
    }

    const vinculo = {
        id: siguienteId(db.vinculos),
        paciente_id: pacienteId,
        tutor_id: tutorId,
        parentesco_id: datos.parentesco_id,
        responsable_principal: datos.responsable_principal,
    };
    db.vinculos.push(vinculo);
    if (vinculo.responsable_principal) {
        desmarcarOtrosPrincipales(vinculo);
    }
    return creado(vinculoJson(vinculo));
}

function tutoresDelPacienteActualizar({ params: [pacienteId, vinculoId], cuerpo }) {
    const ctx = contexto(PERMISO.PACIENTES_EDITAR);
    pacienteParaCtx(ctx, pacienteId);
    const vinculo = vinculoDelPaciente(pacienteId, vinculoId);

    const v = new Validador(cuerpo, true);
    v.referencia('parentesco_id', db.catalogos.parentescos);
    v.booleano('responsable_principal');
    Object.assign(vinculo, v.terminar());

    if (vinculo.responsable_principal) {
        desmarcarOtrosPrincipales(vinculo);
    }
    return ok(vinculoJson(vinculo));
}

function tutoresDelPacienteDesvincular({ params: [pacienteId, vinculoId] }) {
    const ctx = contexto(PERMISO.PACIENTES_EDITAR);
    pacienteParaCtx(ctx, pacienteId);
    const vinculo = vinculoDelPaciente(pacienteId, vinculoId);
    db.vinculos = db.vinculos.filter((x) => x.id !== vinculo.id);
    return sinContenido();
}

function tutoresBuscar({ query }) {
    const ctx = contexto(PERMISO.PACIENTES_VER);
    const q = normalizar(query.q);
    if (!q) {
        return ok([]);
    }

    let lista = db.tutores;
    if (!ctx.admin) {
        const visibles = new Set(db.vinculos
            .filter((v) => pacienteVisible(ctx, porId(db.pacientes, v.paciente_id)))
            .map((v) => v.tutor_id));
        lista = lista.filter((t) => visibles.has(t.id));
    }

    return ok(lista
        .filter((t) => normalizar(`${t.nombre} ${t.apellido} ${t.mail ?? ''} ${t.telefono_movil ?? ''} ${t.apellido} ${t.nombre}`).includes(q))
        .slice(0, 20)
        .map(tutorJson));
}

function tutoresActualizar({ params: [id], cuerpo }) {
    contexto(PERMISO.PACIENTES_EDITAR);
    const tutor = porId(db.tutores, id);
    if (!tutor) {
        throw noEncontrado();
    }
    Object.assign(tutor, validarTutor(cuerpo, true).terminar());
    return ok(tutorJson(tutor));
}

// ============================================================
// §7 Turnos
// ============================================================
const ordenTurnos = (a, b) =>
    a.fecha.localeCompare(b.fecha) || a.hora_inicio.localeCompare(b.hora_inicio) || a.profesional_id - b.profesional_id;

function turnosListar({ query }) {
    const ctx = contexto(PERMISO.TURNOS_VER);

    const v = new Validador(query, true);
    v.fecha('fecha');
    v.fecha('desde');
    v.fecha('hasta');
    const { fecha, desde, hasta } = v.terminar();

    const hayRango = desde !== undefined || hasta !== undefined;
    if (hayRango && (!desde || !hasta)) {
        throw invalido({ non_field_errors: ['Indicá "desde" y "hasta" juntos.'] });
    }
    if (hayRango && hasta < desde) {
        throw invalido({ hasta: ['"hasta" no puede ser anterior a "desde".'] });
    }
    if (hayRango && diasEntre(desde, hasta) > 31) {
        throw invalido({ hasta: ['El rango no puede superar 31 días.'] });
    }
    if (!fecha && !hayRango && !query.paciente) {
        throw invalido({ non_field_errors: ['Indicá una fecha, un rango desde/hasta o un paciente.'] });
    }

    let lista = db.turnos.filter((t) => turnoVisible(ctx, t));
    if (fecha) {
        lista = lista.filter((t) => t.fecha === fecha);
    }
    if (hayRango) {
        lista = lista.filter((t) => t.fecha >= desde && t.fecha <= hasta);
    }
    if (query.paciente) {
        lista = lista.filter((t) => t.paciente_id === Number(query.paciente));
    }
    if (query.profesional && ctx.admin) {
        lista = lista.filter((t) => t.profesional_id === Number(query.profesional));
    }
    if (query.estado) {
        const estados = query.estado.split(',').map(Number);
        lista = lista.filter((t) => estados.includes(t.estado_id));
    }

    // Historial de un paciente: paginado, del más reciente al más viejo
    if (!fecha && !hayRango) {
        const historial = [...lista].sort((a, b) => ordenTurnos(b, a)).map(turnoJson);
        return ok(paginar(historial, query, '/turnos/'));
    }
    return ok([...lista].sort(ordenTurnos).map(turnoJson));
}

function turnosObtener({ params: [id] }) {
    const ctx = contexto(PERMISO.TURNOS_VER);
    return ok(turnoJson(turnoParaCtx(ctx, id)));
}

function verificarSuperposicion(turno) {
    const seSuperpone = (otro) =>
        otro.id !== turno.id
        && otro.estado_id !== ESTADO_TURNO.CANCELADO
        && otro.fecha === turno.fecha
        && otro.hora_inicio < turno.hora_fin
        && turno.hora_inicio < otro.hora_fin;

    if (db.turnos.some((o) => seSuperpone(o) && o.profesional_id === turno.profesional_id)) {
        throw conflicto('El profesional ya tiene un turno en ese horario.', 'turno_superpuesto');
    }
    if (db.turnos.some((o) => seSuperpone(o) && o.paciente_id === turno.paciente_id)) {
        throw conflicto('El paciente ya tiene un turno en ese horario.', 'turno_superpuesto');
    }
}

// Reglas de negocio comunes al alta y a la reprogramación
function validarHorario(v, turno, { fechaCambio }) {
    if (fechaCambio && turno.fecha < hoy()) {
        v.error('fecha', 'No se pueden asignar turnos en fechas pasadas.');
    }
    if (turno.hora_fin <= turno.hora_inicio) {
        v.error('hora_fin', 'La hora de fin debe ser posterior a la de inicio.');
    }
    if (porId(db.profesionales, turno.profesional_id).estado_id !== 1) {
        v.error('profesional_id', 'El profesional no está activo.');
    }
}

function turnosCrear({ cuerpo }) {
    const ctx = contexto(PERMISO.TURNOS_EDITAR);

    const v = new Validador(cuerpo);
    v.fecha('fecha');
    v.hora('hora_inicio');
    v.hora('hora_fin');
    v.referencia('paciente_id', db.pacientes);
    v.referencia('profesional_id', db.profesionales);
    v.referencia('estado_id', db.catalogos.estados_turnos, { porDefecto: ESTADO_TURNO.PENDIENTE });
    const datos = v.terminar();

    if (!ctx.admin && datos.profesional_id !== ctx.profesional?.id) {
        throw sinPermiso('Solo podés crear turnos en tu propia agenda.');
    }

    const paciente = porId(db.pacientes, datos.paciente_id);
    if (!pacienteVisible(ctx, paciente)) {
        v.error('paciente_id', 'El paciente no está asignado a vos.');
    } else if (paciente.estado_id !== ESTADO_PACIENTE.ACTIVO) {
        v.error('paciente_id', 'El paciente está inactivo.');
    }
    if (![ESTADO_TURNO.PENDIENTE, ESTADO_TURNO.CONFIRMADO].includes(datos.estado_id)) {
        v.error('estado_id', 'Un turno nuevo solo puede estar Pendiente o Confirmado.');
    }

    const turno = { id: siguienteId(db.turnos), ...datos, registro_sesion_id: null };
    validarHorario(v, turno, { fechaCambio: true });
    v.terminar();
    verificarSuperposicion(turno);

    db.turnos.push(turno);
    return creado(turnoJson(turno));
}

function turnosActualizar({ params: [id], cuerpo }) {
    const ctx = contexto(PERMISO.TURNOS_EDITAR);
    const turno = turnoParaCtx(ctx, id);

    const v = new Validador(cuerpo, true);
    v.fecha('fecha');
    v.hora('hora_inicio');
    v.hora('hora_fin');
    v.referencia('profesional_id', db.profesionales);
    v.referencia('estado_id', db.catalogos.estados_turnos);
    const datos = v.terminar();

    if (!ctx.admin && datos.profesional_id !== undefined && datos.profesional_id !== turno.profesional_id) {
        throw sinPermiso('Solo el administrador puede cambiar el profesional de un turno.');
    }

    const nombreEstado = (estadoId) => catalogo('estados_turnos', estadoId).nombre;
    const esFinal = TRANSICIONES_TURNO[turno.estado_id].length === 0;
    const reprograma = ['fecha', 'hora_inicio', 'hora_fin', 'profesional_id'].some((c) => datos[c] !== undefined);

    if (reprograma && esFinal) {
        throw invalido({ non_field_errors: [`No se puede reprogramar un turno ${nombreEstado(turno.estado_id).toLowerCase()}.`] });
    }
    if (datos.estado_id !== undefined && datos.estado_id !== turno.estado_id) {
        if (!TRANSICIONES_TURNO[turno.estado_id].includes(datos.estado_id)) {
            throw invalido({
                estado_id: [`No se puede pasar de ${nombreEstado(turno.estado_id)} a ${nombreEstado(datos.estado_id)}.`],
            });
        }
    }

    const actualizado = { ...turno, ...datos };
    if (actualizado.estado_id === ESTADO_TURNO.REALIZADO && actualizado.fecha > hoy()) {
        v.error('estado_id', 'No se puede marcar como realizado un turno futuro.');
    }
    if (reprograma) {
        validarHorario(v, actualizado, { fechaCambio: datos.fecha !== undefined && datos.fecha !== turno.fecha });
    }
    v.terminar();
    if (reprograma) {
        verificarSuperposicion(actualizado);
    }

    Object.assign(turno, datos);
    return ok(turnoJson(turno));
}

// ------------------------------------------------------------
// Registro de sesión (nota clínica)
// ------------------------------------------------------------
function turnoPropio(ctx, id) {
    const turno = turnoParaCtx(ctx, id);
    if (turno.profesional_id !== ctx.profesional?.id) {
        throw sinPermiso('Solo el profesional del turno puede registrar la sesión.');
    }
    return turno;
}

function registroDelTurno(turno) {
    const registro = porId(db.registros, turno.registro_sesion_id);
    if (!registro) {
        throw noEncontrado('El turno no tiene registro de sesión.');
    }
    return registro;
}

function sesionObtener({ params: [id] }) {
    const ctx = contexto(PERMISO.SESIONES_VER);
    const turno = turnoParaCtx(ctx, id);
    return ok(registroJson(turno, registroDelTurno(turno)));
}

function sesionRegistrar({ params: [id], cuerpo }) {
    const ctx = contexto(PERMISO.SESIONES_REGISTRAR);
    const turno = turnoPropio(ctx, id);

    if (turno.registro_sesion_id !== null) {
        throw conflicto('Este turno ya tiene un registro de sesión.', 'sesion_existente');
    }

    const v = new Validador(cuerpo);
    v.texto('nota_clinica', { max: 5000 });
    v.booleano('marcar_realizado', { porDefecto: false });
    const datos = v.terminar();

    if (![ESTADO_TURNO.CONFIRMADO, ESTADO_TURNO.REALIZADO].includes(turno.estado_id)) {
        throw invalido({ non_field_errors: ['Solo se puede registrar la sesión de un turno confirmado o realizado.'] });
    }
    if (turno.fecha > hoy()) {
        throw invalido({ non_field_errors: ['No se puede registrar la sesión de un turno futuro.'] });
    }

    const registro = {
        id: siguienteId(db.registros),
        nota_clinica: datos.nota_clinica,
        autor_id: ctx.profesional.id,
        creado: ahoraISO(),
        modificado: null,
    };
    db.registros.push(registro);
    turno.registro_sesion_id = registro.id;
    if (datos.marcar_realizado) {
        turno.estado_id = ESTADO_TURNO.REALIZADO;
    }
    return creado(registroJson(turno, registro));
}

function sesionActualizar({ params: [id], cuerpo }) {
    const ctx = contexto(PERMISO.SESIONES_REGISTRAR);
    const turno = turnoPropio(ctx, id);
    const registro = registroDelTurno(turno);

    const v = new Validador(cuerpo, true);
    v.texto('nota_clinica', { max: 5000 });
    const datos = v.terminar();

    if (datos.nota_clinica !== undefined) {
        registro.nota_clinica = datos.nota_clinica;
        registro.modificado = ahoraISO();
    }
    return ok(registroJson(turno, registro));
}

// ============================================================
// §8 Profesionales
// ============================================================
function profesionalesListar({ query }) {
    const ctx = contexto(PERMISO.PROFESIONALES_VER);
    let lista = db.profesionales;

    if (query.q) {
        const q = normalizar(query.q);
        lista = lista.filter((p) => normalizar(`${p.nombre} ${p.apellido} ${p.matricula} ${p.apellido} ${p.nombre}`).includes(q));
    }
    if (query.especialidad) {
        lista = lista.filter((p) => p.especialidad_id === Number(query.especialidad));
    }
    if (query.estado) {
        lista = lista.filter((p) => p.estado_id === Number(query.estado));
    }

    const ordenados = [...lista]
        .sort((a, b) => a.apellido.localeCompare(b.apellido) || a.nombre.localeCompare(b.nombre))
        .map((p) => profesionalJson(p, ctx));
    return ok(paginar(ordenados, query, '/profesionales/'));
}

function profesionalesObtener({ params: [id] }) {
    const ctx = contexto(PERMISO.PROFESIONALES_VER);
    const profesional = porId(db.profesionales, id);
    if (!profesional) {
        throw noEncontrado();
    }
    return ok(profesionalJson(profesional, ctx));
}

function validarProfesional(cuerpo, parcial) {
    const v = new Validador(cuerpo, parcial);
    v.texto('nombre', { max: 100 });
    v.texto('apellido', { max: 100 });
    v.texto('dni', { patron: PATRON_DNI, mensajePatron: MENSAJE_DNI });
    v.texto('matricula', { max: 50 });
    v.referencia('especialidad_id', db.catalogos.especialidades);
    v.texto('contacto', { max: 50, obligatorio: false });
    v.texto('mail', { max: 50, obligatorio: false, patron: PATRON_MAIL, mensajePatron: MENSAJE_MAIL });
    v.referencia('estado_id', db.catalogos.estados_profesionales, { porDefecto: 1 });
    return v;
}

function verificarDniProfesional(dni, idActual = null) {
    if (dni && db.profesionales.some((p) => p.dni === dni && p.id !== idActual)) {
        throw conflicto('Ya existe un profesional con ese DNI.', 'dni_duplicado');
    }
}

function profesionalesCrear({ cuerpo }) {
    const ctx = contexto(PERMISO.PROFESIONALES_EDITAR);
    const v = validarProfesional(cuerpo, false);

    // Usuario anidado: los errores se devuelven anidados, como en DRF
    let datosUsuario = null;
    if (cuerpo.usuario && typeof cuerpo.usuario === 'object') {
        const vUsuario = new Validador(cuerpo.usuario);
        vUsuario.texto('usuario', {
            max: 100,
            patron: /^[a-zA-Z0-9._-]{3,}$/,
            mensajePatron: 'Usá al menos 3 caracteres: letras, números, punto, guion o guion bajo.',
        });
        vUsuario.password('password');
        if (vUsuario.limpios.usuario && db.usuarios.some((u) => u.usuario === vUsuario.limpios.usuario)) {
            vUsuario.error('usuario', 'Ya existe un usuario con ese nombre.');
        }
        if (vUsuario.hayErrores) {
            v.errores.usuario = vUsuario.errores;
        }
        datosUsuario = vUsuario.limpios;
    } else {
        v.error('usuario', OBLIGATORIO);
    }

    const datos = v.terminar();
    verificarDniProfesional(datos.dni);

    const usuario = {
        id: siguienteId(db.usuarios),
        usuario: datosUsuario.usuario,
        rol_id: ROL.PROFESIONAL,
        password: datosUsuario.password,
    };
    const profesional = { id: siguienteId(db.profesionales), ...datos, usuario_id: usuario.id };
    db.usuarios.push(usuario);
    db.profesionales.push(profesional);
    return creado(profesionalJson(profesional, ctx));
}

function profesionalesActualizar({ params: [id], cuerpo }) {
    const ctx = contexto(PERMISO.PROFESIONALES_EDITAR);
    const profesional = porId(db.profesionales, id);
    if (!profesional) {
        throw noEncontrado();
    }
    const datos = validarProfesional(cuerpo, true).terminar();
    verificarDniProfesional(datos.dni, id);
    Object.assign(profesional, datos);
    return ok(profesionalJson(profesional, ctx));
}

// ------------------------------------------------------------
// Asignaciones
// ------------------------------------------------------------
function asignacionesListar({ query }) {
    const ctx = contexto(PERMISO.PACIENTES_VER);
    let lista = ctx.admin ? db.asignaciones : db.asignaciones.filter((a) => a.profesional_id === ctx.profesional?.id);

    if (query.paciente) {
        lista = lista.filter((a) => a.paciente_id === Number(query.paciente));
    }
    if (query.profesional) {
        lista = lista.filter((a) => a.profesional_id === Number(query.profesional));
    }
    if (query.vigentes === 'true') {
        lista = lista.filter(asignacionVigente);
    }
    return ok([...lista].sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio)).map(asignacionJson));
}

function asignacionesCrear({ cuerpo }) {
    contexto(PERMISO.PROFESIONALES_EDITAR);
    const v = new Validador(cuerpo);
    v.referencia('paciente_id', db.pacientes);
    v.referencia('profesional_id', db.profesionales);
    v.fecha('fecha_inicio');
    v.fecha('fecha_fin', { obligatorio: false });
    const datos = v.limpios;
    if (datos.fecha_inicio && datos.fecha_fin && datos.fecha_fin < datos.fecha_inicio) {
        v.error('fecha_fin', 'La fecha de fin no puede ser anterior a la de inicio.');
    }
    v.terminar();

    const asignacion = { id: siguienteId(db.asignaciones), ...datos };
    const duplicada = db.asignaciones.some((a) =>
        a.paciente_id === datos.paciente_id && a.profesional_id === datos.profesional_id && asignacionVigente(a));
    if (duplicada && asignacionVigente(asignacion)) {
        throw conflicto('El paciente ya tiene una asignación vigente con ese profesional.', 'asignacion_duplicada');
    }
    db.asignaciones.push(asignacion);
    return creado(asignacionJson(asignacion));
}

function asignacionesActualizar({ params: [id], cuerpo }) {
    contexto(PERMISO.PROFESIONALES_EDITAR);
    const asignacion = porId(db.asignaciones, id);
    if (!asignacion) {
        throw noEncontrado();
    }
    const v = new Validador(cuerpo, true);
    v.fecha('fecha_inicio');
    v.fecha('fecha_fin', { nulo: true });
    const final = { ...asignacion, ...v.limpios };
    if (final.fecha_fin !== null && final.fecha_fin < final.fecha_inicio) {
        v.error('fecha_fin', 'La fecha de fin no puede ser anterior a la de inicio.');
    }
    Object.assign(asignacion, v.terminar());
    return ok(asignacionJson(asignacion));
}

// ------------------------------------------------------------
// Obras sociales
// ------------------------------------------------------------
function obrasSocialesListar({ query }) {
    usuarioActual();
    let lista = db.obras_sociales;
    if (query.estado) {
        lista = lista.filter((os) => os.estado_id === Number(query.estado));
    }
    return ok([...lista].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(obraSocialJson));
}

function obraSocialPorId(id) {
    const os = porId(db.obras_sociales, id);
    if (!os) {
        throw noEncontrado();
    }
    return os;
}

function obrasSocialesObtener({ params: [id] }) {
    usuarioActual();
    return ok(obraSocialJson(obraSocialPorId(id)));
}

function validarObraSocial(cuerpo, parcial, idActual = null) {
    const v = new Validador(cuerpo, parcial);
    v.texto('nombre', { max: 150 });
    v.texto('contacto', { max: 150, obligatorio: false });
    v.texto('mail', { max: 150, obligatorio: false, patron: PATRON_MAIL, mensajePatron: MENSAJE_MAIL });
    v.texto('web', { max: 255, obligatorio: false });
    v.referencia('tipo_id', db.catalogos.tipos_obras_sociales);
    v.referencia('estado_id', db.catalogos.estados_obras_sociales, { porDefecto: 1 });
    const datos = v.terminar();

    if (datos.nombre && db.obras_sociales.some((os) => normalizar(os.nombre) === normalizar(datos.nombre) && os.id !== idActual)) {
        throw conflicto('Ya existe una obra social con ese nombre.', 'obra_social_duplicada');
    }
    return datos;
}

function obrasSocialesCrear({ cuerpo }) {
    contexto(PERMISO.OBRAS_SOCIALES_EDITAR);
    const os = { id: siguienteId(db.obras_sociales), ...validarObraSocial(cuerpo, false) };
    db.obras_sociales.push(os);
    return creado(obraSocialJson(os));
}

function obrasSocialesActualizar({ params: [id], cuerpo }) {
    contexto(PERMISO.OBRAS_SOCIALES_EDITAR);
    const os = obraSocialPorId(id);
    Object.assign(os, validarObraSocial(cuerpo, true, id));
    return ok(obraSocialJson(os));
}

// ============================================================
// §9 Usuarios
// ============================================================
function usuarioPorId(id) {
    const usuario = porId(db.usuarios, id);
    if (!usuario) {
        throw noEncontrado();
    }
    return usuario;
}

function usuariosListar() {
    contexto(PERMISO.USUARIOS_ADMIN);
    return ok([...db.usuarios].sort((a, b) => a.usuario.localeCompare(b.usuario)).map(usuarioJson));
}

function usuariosCrear({ cuerpo }) {
    contexto(PERMISO.USUARIOS_ADMIN);
    const v = new Validador(cuerpo);
    v.texto('usuario', { max: 100 });
    v.password('password');
    v.referencia('rol_id', db.catalogos.roles);
    if (v.limpios.usuario && db.usuarios.some((u) => u.usuario === v.limpios.usuario)) {
        v.error('usuario', 'Ya existe un usuario con ese nombre.');
    }
    const datos = v.terminar();

    const usuario = { id: siguienteId(db.usuarios), ...datos };
    db.usuarios.push(usuario);
    return creado(usuarioJson(usuario));
}

function usuariosActualizar({ params: [id], cuerpo }) {
    const ctx = contexto(PERMISO.USUARIOS_ADMIN);
    const usuario = usuarioPorId(id);
    const v = new Validador(cuerpo, true);
    v.referencia('rol_id', db.catalogos.roles);
    if (v.limpios.rol_id !== undefined && usuario.id === ctx.usuario.id && v.limpios.rol_id !== usuario.rol_id) {
        v.error('rol_id', 'No podés cambiar tu propio rol.');
    }
    Object.assign(usuario, v.terminar());
    return ok(usuarioJson(usuario));
}

function usuariosResetearPassword({ params: [id], cuerpo }) {
    contexto(PERMISO.USUARIOS_ADMIN);
    const usuario = usuarioPorId(id);
    const v = new Validador(cuerpo);
    v.password('password_nuevo');
    usuario.password = v.terminar().password_nuevo;
    return sinContenido();
}

// ============================================================
// Rutas
// ============================================================
const RUTAS = [
    ['GET', /^\/auth\/csrf\/$/, authCsrf],
    ['POST', /^\/auth\/login\/$/, authLogin],
    ['POST', /^\/auth\/logout\/$/, authLogout],
    ['GET', /^\/auth\/me\/$/, authMe],
    ['POST', /^\/auth\/cambiar-password\/$/, authCambiarPassword],

    ['GET', /^\/catalogos\/$/, catalogosObtener],
    ['GET', /^\/dashboard\/resumen\/$/, dashboardResumen],

    ['GET', /^\/pacientes\/$/, pacientesListar],
    ['POST', /^\/pacientes\/$/, pacientesCrear],
    ['GET', /^\/pacientes\/cud-por-vencer\/$/, pacientesCudPorVencer],
    ['GET', /^\/pacientes\/(\d+)\/$/, pacientesObtener],
    ['PATCH', /^\/pacientes\/(\d+)\/$/, pacientesActualizar],
    ['GET', /^\/pacientes\/(\d+)\/tutores\/$/, tutoresDelPacienteListar],
    ['POST', /^\/pacientes\/(\d+)\/tutores\/$/, tutoresDelPacienteVincular],
    ['PATCH', /^\/pacientes\/(\d+)\/tutores\/(\d+)\/$/, tutoresDelPacienteActualizar],
    ['DELETE', /^\/pacientes\/(\d+)\/tutores\/(\d+)\/$/, tutoresDelPacienteDesvincular],
    ['GET', /^\/tutores\/$/, tutoresBuscar],
    ['PATCH', /^\/tutores\/(\d+)\/$/, tutoresActualizar],

    ['GET', /^\/turnos\/$/, turnosListar],
    ['POST', /^\/turnos\/$/, turnosCrear],
    ['GET', /^\/turnos\/(\d+)\/$/, turnosObtener],
    ['PATCH', /^\/turnos\/(\d+)\/$/, turnosActualizar],
    ['GET', /^\/turnos\/(\d+)\/sesion\/$/, sesionObtener],
    ['POST', /^\/turnos\/(\d+)\/sesion\/$/, sesionRegistrar],
    ['PATCH', /^\/turnos\/(\d+)\/sesion\/$/, sesionActualizar],

    ['GET', /^\/profesionales\/$/, profesionalesListar],
    ['POST', /^\/profesionales\/$/, profesionalesCrear],
    ['GET', /^\/profesionales\/(\d+)\/$/, profesionalesObtener],
    ['PATCH', /^\/profesionales\/(\d+)\/$/, profesionalesActualizar],

    ['GET', /^\/asignaciones\/$/, asignacionesListar],
    ['POST', /^\/asignaciones\/$/, asignacionesCrear],
    ['PATCH', /^\/asignaciones\/(\d+)\/$/, asignacionesActualizar],

    ['GET', /^\/obras-sociales\/$/, obrasSocialesListar],
    ['POST', /^\/obras-sociales\/$/, obrasSocialesCrear],
    ['GET', /^\/obras-sociales\/(\d+)\/$/, obrasSocialesObtener],
    ['PATCH', /^\/obras-sociales\/(\d+)\/$/, obrasSocialesActualizar],

    ['GET', /^\/usuarios\/$/, usuariosListar],
    ['POST', /^\/usuarios\/$/, usuariosCrear],
    ['PATCH', /^\/usuarios\/(\d+)\/$/, usuariosActualizar],
    ['POST', /^\/usuarios\/(\d+)\/resetear-password\/$/, usuariosResetearPassword],
];

function despachar(metodo, ruta, query, cuerpo) {
    let rutaExiste = false;
    for (const [metodoRuta, patron, manejador] of RUTAS) {
        const coincidencia = ruta.match(patron);
        if (!coincidencia) {
            continue;
        }
        rutaExiste = true;
        if (metodoRuta === metodo) {
            return manejador({ params: coincidencia.slice(1).map(Number), query, cuerpo });
        }
    }
    if (rutaExiste) {
        throw new ErrorHttp(405, { detail: `Método "${metodo}" no permitido.` });
    }
    throw noEncontrado();
}

// ============================================================
// Reemplazo de fetch()
// ============================================================
function esperar(ms, signal) {
    return new Promise((resolver, rechazar) => {
        if (signal?.aborted) {
            rechazar(signal.reason);
            return;
        }
        const temporizador = setTimeout(resolver, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(temporizador);
            rechazar(signal.reason);
        }, { once: true });
    });
}

function respuestaJson(status, cuerpo) {
    if (status === 204 || cuerpo === null) {
        return new Response(null, { status });
    }
    return new Response(JSON.stringify(cuerpo), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function mockFetch(url, init = {}) {
    await esperar(CONFIG.MOCK_LATENCIA_MS, init.signal);

    const direccion = new URL(url, 'http://mock.local');
    const ruta = direccion.pathname.startsWith(CONFIG.API_BASE)
        ? direccion.pathname.slice(CONFIG.API_BASE.length)
        : direccion.pathname;
    const metodo = (init.method || 'GET').toUpperCase();
    const query = Object.fromEntries(direccion.searchParams);

    let cuerpo = {};
    if (init.body) {
        try {
            cuerpo = JSON.parse(init.body);
        } catch {
            return respuestaJson(400, { detail: 'JSON mal formado.' });
        }
    }

    cargarEstado();
    sincronizarSesion();

    try {
        const { status, cuerpo: salida } = despachar(metodo, ruta, query, cuerpo);
        return respuestaJson(status, salida);
    } catch (error) {
        if (error instanceof ErrorHttp) {
            return respuestaJson(error.status, error.cuerpo);
        }
        console.error('[EduGes mock] Error interno:', error);
        return respuestaJson(500, { detail: 'Error interno de la API simulada.' });
    } finally {
        if (metodo !== 'GET') {
            guardarEstado();
        }
    }
}
