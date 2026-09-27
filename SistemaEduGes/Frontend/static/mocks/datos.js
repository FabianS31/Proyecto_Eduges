// ============================================================
// EduGes - Datos de la API simulada
// Personas y datos FICTICIOS, solo para desarrollo del frontend.
// Las fechas se calculan a partir del día de hoy, así el dashboard
// siempre tiene turnos del día y CUD por vencer.
//
// La forma de los datos imita las tablas de la BD (con ids de clave
// foránea); la conversión al JSON del contrato la hace servidor.js.
// ============================================================

import { aFecha, diasEntre, fechaISO, hoyISO, sumarDias } from '../js/fechas.js';

export { diasEntre, fechaISO, hoyISO, sumarDias };

// Contraseña de todos los usuarios simulados
export const PASSWORD_MOCK = 'demo1234';

function diaDeLaSemana(iso) {
    return aFecha(iso).getDay(); // 0 = domingo ... 6 = sábado
}

function sumarMinutos(hora, minutos) {
    const [h, m] = hora.split(':').map(Number);
    const total = h * 60 + m + minutos;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
}

// ------------------------------------------------------------
// Catálogos
// ------------------------------------------------------------
const CATALOGOS = {
    roles: [
        { id: 1, nombre: 'Administrador' },
        { id: 2, nombre: 'Profesional' },
    ],
    estados_turnos: [
        { id: 1, nombre: 'Pendiente' },
        { id: 2, nombre: 'Confirmado' },
        { id: 3, nombre: 'Cancelado' },
        { id: 4, nombre: 'Realizado' },
    ],
    estados_pacientes: [
        { id: 1, nombre: 'Activo' },
        { id: 2, nombre: 'Inactivo' },
    ],
    estados_profesionales: [
        { id: 1, nombre: 'Activo' },
        { id: 2, nombre: 'Licencia' },
        { id: 3, nombre: 'Inactivo' },
    ],
    especialidades: [
        { id: 1, nombre: 'Psicología Pediátrica' },
        { id: 2, nombre: 'Psicopedagogía' },
        { id: 3, nombre: 'Fonoaudiología' },
        { id: 4, nombre: 'Terapia Ocupacional' },
    ],
    parentescos: [
        { id: 1, nombre: 'Madre' },
        { id: 2, nombre: 'Padre' },
        { id: 3, nombre: 'Abuela/o' },
        { id: 4, nombre: 'Tía/o' },
        { id: 5, nombre: 'Tutor/a legal' },
    ],
    tipos_obras_sociales: [
        { id: 1, nombre: 'Obra social nacional' },
        { id: 2, nombre: 'Prepaga' },
        { id: 3, nombre: 'Obra social provincial' },
        { id: 4, nombre: 'Sin cobertura' },
    ],
    estados_obras_sociales: [
        { id: 1, nombre: 'Activa' },
        { id: 2, nombre: 'Inactiva' },
    ],
};

const OBRAS_SOCIALES = [
    { id: 1, nombre: 'Particular / Sin obra social', contacto: null, mail: null, web: null, tipo_id: 4, estado_id: 1 },
    { id: 2, nombre: 'OSDE', contacto: '0810-555-6733', mail: null, web: 'https://www.osde.com.ar', tipo_id: 2, estado_id: 1 },
    { id: 3, nombre: 'Swiss Medical', contacto: '0810-333-8876', mail: null, web: 'https://www.swissmedical.com.ar', tipo_id: 2, estado_id: 1 },
    { id: 4, nombre: 'APROSS', contacto: '0800-555-2776', mail: null, web: 'https://www.apross.gov.ar', tipo_id: 3, estado_id: 1 },
    { id: 5, nombre: 'OSECAC', contacto: '0810-666-7322', mail: null, web: 'https://www.osecac.org.ar', tipo_id: 1, estado_id: 1 },
    { id: 6, nombre: 'Obra Social Ejemplo (dada de baja)', contacto: null, mail: null, web: null, tipo_id: 1, estado_id: 2 },
];

// ------------------------------------------------------------
// Usuarios y profesionales
// ------------------------------------------------------------
const USUARIOS = [
    { id: 1, usuario: 'admin', rol_id: 1, password: PASSWORD_MOCK },
    { id: 2, usuario: 'msoto', rol_id: 2, password: PASSWORD_MOCK },
    { id: 3, usuario: 'vmartinez', rol_id: 2, password: PASSWORD_MOCK },
    { id: 4, usuario: 'dfernandez', rol_id: 2, password: PASSWORD_MOCK },
    { id: 5, usuario: 'crios', rol_id: 2, password: PASSWORD_MOCK },
];

// Usuario que usa la API simulada para cada rol de prueba (?rol=...)
export const USUARIO_POR_ROL_MOCK = { admin: 1, profesional: 2 };

const PROFESIONALES = [
    { id: 1, nombre: 'Mariana', apellido: 'Soto', dni: '28456123', matricula: 'MP 4521', especialidad_id: 1,
      contacto: '3515551001', mail: 'msoto@rinconpsi.test', usuario_id: 2, estado_id: 1 },
    { id: 2, nombre: 'Valeria', apellido: 'Martínez', dni: '31789456', matricula: 'MP 5230', especialidad_id: 2,
      contacto: '3515551002', mail: 'vmartinez@rinconpsi.test', usuario_id: 3, estado_id: 1 },
    { id: 3, nombre: 'Diego', apellido: 'Fernández', dni: '30123789', matricula: 'MP 6112', especialidad_id: 3,
      contacto: '3515551003', mail: 'dfernandez@rinconpsi.test', usuario_id: 4, estado_id: 1 },
    { id: 4, nombre: 'Carolina', apellido: 'Ríos', dni: '33654987', matricula: 'MP 7045', especialidad_id: 4,
      contacto: null, mail: 'crios@rinconpsi.test', usuario_id: 5, estado_id: 2 },
];

// Hora de inicio de la agenda de cada profesional
const HORA_BASE_PROFESIONAL = { 1: 9, 2: 13, 3: 9, 4: 14 };
const DURACION_TURNO_MIN = 45;

// ------------------------------------------------------------
// Pacientes (cud: días desde hoy hasta el vencimiento del CUD)
// ------------------------------------------------------------
const PACIENTES = [
    { id: 1, nombre: 'Lucas', apellido: 'Pérez', dni: '50123456', nacimiento: '2018-04-10', cud: 50, os: 2, afiliado: '61234567801', estado: 1 },
    { id: 2, nombre: 'Martina', apellido: 'López', dni: '51234567', nacimiento: '2019-08-22', cud: -15, os: 4, afiliado: 'AP-445566', estado: 1 },
    { id: 3, nombre: 'Tomás', apellido: 'Giménez', dni: '49345678', nacimiento: '2016-01-30', cud: 320, os: 5, afiliado: '0023-778899', estado: 1 },
    { id: 4, nombre: 'Sofía', apellido: 'Giménez', dni: '53456789', nacimiento: '2020-11-05', cud: 12, os: 5, afiliado: '0023-778900', estado: 1 },
    { id: 5, nombre: 'Benjamín', apellido: 'Acosta', dni: '48567890', nacimiento: '2014-06-18', cud: 540, os: 3, afiliado: 'SM-102030', estado: 1 },
    { id: 6, nombre: 'Valentina', apellido: 'Romero', dni: '52678901', nacimiento: '2019-02-14', cud: 35, os: 1, afiliado: '-', estado: 1 },
    { id: 7, nombre: 'Mateo', apellido: 'Sosa', dni: '50789012', nacimiento: '2017-09-09', cud: 210, os: 2, afiliado: '61234567802', estado: 1 },
    { id: 8, nombre: 'Emma', apellido: 'Torres', dni: '54890123', nacimiento: '2021-03-27', cud: 700, os: 4, afiliado: 'AP-778899', estado: 1 },
    { id: 9, nombre: 'Joaquín', apellido: 'Díaz', dni: '47901234', nacimiento: '2013-12-01', cud: -3, os: 3, afiliado: 'SM-405060', estado: 1 },
    { id: 10, nombre: 'Catalina', apellido: 'Ruiz', dni: '51012345', nacimiento: '2018-07-15', cud: 150, os: 5, afiliado: '0023-112233', estado: 1 },
    { id: 11, nombre: 'Felipe', apellido: 'Morales', dni: '49123450', nacimiento: '2015-10-20', cud: 58, os: 2, afiliado: '61234567803', estado: 1 },
    { id: 12, nombre: 'Isabella', apellido: 'Castro', dni: '53234561', nacimiento: '2020-05-03', cud: 400, os: 1, afiliado: '-', estado: 1 },
    { id: 13, nombre: 'Thiago', apellido: 'Herrera', dni: '50345672', nacimiento: '2017-01-11', cud: 95, os: 4, afiliado: 'AP-990011', estado: 1 },
    { id: 14, nombre: 'Delfina', apellido: 'Medina', dni: '52456783', nacimiento: '2019-12-24', cud: 260, os: 3, afiliado: 'SM-708090', estado: 1 },
    { id: 15, nombre: 'Bautista', apellido: 'Vega', dni: '48567894', nacimiento: '2014-03-08', cud: -120, os: 5, afiliado: '0023-445566', estado: 2 },
];

const CALLES = ['Av. Colón', 'Bv. San Juan', 'Obispo Trejo', 'Av. Vélez Sarsfield', 'Duarte Quirós', 'Av. Olmos'];

// ------------------------------------------------------------
// Tutores y vínculos paciente ↔ tutor
// El paciente 14 no tiene tutor cargado (caso a mostrar en la UI).
// Los pacientes 3 y 4 son hermanos y comparten tutores.
// ------------------------------------------------------------
const TUTORES = [
    { id: 1, nombre: 'Laura', apellido: 'Gómez', telefono_fijo: null, telefono_movil: '3514001001', mail: 'laura.gomez@mail.test' },
    { id: 2, nombre: 'Jorge', apellido: 'Pérez', telefono_fijo: '3514220011', telefono_movil: '3514001002', mail: null },
    { id: 3, nombre: 'Andrea', apellido: 'López', telefono_fijo: null, telefono_movil: '3514001003', mail: 'andrea.lopez@mail.test' },
    { id: 4, nombre: 'Paula', apellido: 'Giménez', telefono_fijo: null, telefono_movil: '3514001004', mail: 'paula.gimenez@mail.test' },
    { id: 5, nombre: 'Ricardo', apellido: 'Giménez', telefono_fijo: null, telefono_movil: '3514001005', mail: null },
    { id: 6, nombre: 'Silvia', apellido: 'Acosta', telefono_fijo: '3514220066', telefono_movil: null, mail: null },
    { id: 7, nombre: 'Natalia', apellido: 'Romero', telefono_fijo: null, telefono_movil: '3514001007', mail: 'natalia.romero@mail.test' },
    { id: 8, nombre: 'Gustavo', apellido: 'Sosa', telefono_fijo: null, telefono_movil: '3514001008', mail: null },
    { id: 9, nombre: 'Carla', apellido: 'Torres', telefono_fijo: null, telefono_movil: '3514001009', mail: 'carla.torres@mail.test' },
    { id: 10, nombre: 'Marta', apellido: 'Díaz', telefono_fijo: '3514220100', telefono_movil: '3514001010', mail: null },
    { id: 11, nombre: 'Lorena', apellido: 'Ruiz', telefono_fijo: null, telefono_movil: '3514001011', mail: 'lorena.ruiz@mail.test' },
    { id: 12, nombre: 'Pablo', apellido: 'Morales', telefono_fijo: null, telefono_movil: '3514001012', mail: null },
    { id: 13, nombre: 'Verónica', apellido: 'Castro', telefono_fijo: null, telefono_movil: '3514001013', mail: 'veronica.castro@mail.test' },
    { id: 14, nombre: 'Julieta', apellido: 'Herrera', telefono_fijo: null, telefono_movil: '3514001014', mail: null },
    { id: 15, nombre: 'Claudia', apellido: 'Vega', telefono_fijo: null, telefono_movil: '3514001015', mail: null },
];

// [paciente, tutor, parentesco, responsable principal]
const VINCULOS = [
    [1, 1, 1, true], [1, 2, 2, false],
    [2, 3, 1, true],
    [3, 4, 1, true], [3, 5, 2, false],
    [4, 4, 1, true], [4, 5, 2, false],
    [5, 6, 3, true],
    [6, 7, 1, true],
    [7, 8, 2, true],
    [8, 9, 1, true],
    [9, 10, 3, true],
    [10, 11, 1, true],
    [11, 12, 2, true],
    [12, 13, 1, true],
    [13, 14, 4, true],
    [15, 15, 5, true],
];

// ------------------------------------------------------------
// Asignaciones [paciente, profesional, inicio (días desde hoy), fin (días desde hoy | null)]
// ------------------------------------------------------------
const ASIGNACIONES = [
    [1, 1, -200, null], [1, 3, -150, null],
    [2, 1, -300, null],
    [3, 2, -250, null],
    [4, 2, -120, null], [4, 1, -90, null],
    [5, 1, -400, null],
    [6, 3, -180, null], [6, 4, -300, -10],
    [7, 1, -100, null], [7, 2, -60, null],
    [8, 3, -45, null],
    [9, 2, -220, null], [9, 4, -200, -10],
    [10, 1, -30, null],
    [11, 3, -160, null], [11, 2, -80, null],
    [12, 1, -20, null],
    [13, 2, -140, null],
    [14, 3, -75, null],
    [15, 1, -365, -20],
];

const NOTAS_CLINICAS = [
    'Sesión centrada en regulación emocional. Se trabajó con pictogramas de emociones; buena respuesta al cierre.',
    'Actividades de integración sensorial con circuito motor. Toleró mejor los cambios de consigna que la semana anterior.',
    'Juego simbólico con familia de muñecos. Apareció el tema de la escuela; se sugiere entrevista con la docente.',
    'Trabajo de lectoescritura con apoyo visual. Mantuvo la atención 20 minutos sin pausas.',
    'Ejercicios de praxias y articulación del fonema /r/. Se entrega material para practicar en casa.',
    'Sesión con la madre presente al inicio. Se acordaron pautas para la rutina de la mañana.',
];

// ------------------------------------------------------------
// Generación de turnos
// Cada asignación vigente tiene dos turnos semanales, en días hábiles.
// Se generan desde 14 días antes hasta 14 días después de hoy.
// ------------------------------------------------------------
function generarTurnos(hoy, asignaciones) {
    const candidatos = [];
    const indicePorProfesional = {};

    for (const asignacion of asignaciones) {
        const k = indicePorProfesional[asignacion.profesional_id] ?? 0;
        indicePorProfesional[asignacion.profesional_id] = k + 1;

        // Dos franjas por semana, sin superponerse dentro del mismo profesional
        const franjas = [
            { dia: (k % 5) + 1, orden: Math.floor(k / 5) * 2 },
            { dia: ((k + 2) % 5) + 1, orden: Math.floor(k / 5) * 2 + 1 },
        ];

        const desde = Math.max(-14, diasEntre(hoy, asignacion.fecha_inicio));
        const hasta = asignacion.fecha_fin === null ? 14 : Math.min(14, diasEntre(hoy, asignacion.fecha_fin));

        for (let offset = desde; offset <= hasta; offset++) {
            const fecha = sumarDias(hoy, offset);
            let dia = diaDeLaSemana(fecha);
            if (dia === 0 || dia === 6) {
                // Fin de semana: sin turnos, salvo hoy (usa la agenda del lunes para que el dashboard tenga datos)
                if (offset !== 0) {
                    continue;
                }
                dia = 1;
            }
            for (const franja of franjas) {
                if (franja.dia !== dia) {
                    continue;
                }
                const horaInicio = sumarMinutos(`${HORA_BASE_PROFESIONAL[asignacion.profesional_id]}:00`, franja.orden * 60);
                candidatos.push({
                    fecha,
                    offset,
                    hora_inicio: horaInicio,
                    hora_fin: sumarMinutos(horaInicio, DURACION_TURNO_MIN),
                    paciente_id: asignacion.paciente_id,
                    profesional_id: asignacion.profesional_id,
                });
            }
        }
    }

    candidatos.sort((a, b) =>
        a.fecha.localeCompare(b.fecha) || a.hora_inicio.localeCompare(b.hora_inicio) || a.profesional_id - b.profesional_id);

    // Un paciente no puede tener dos turnos a la misma hora con distintos profesionales
    const ocupados = new Set();
    const turnos = [];
    for (const c of candidatos) {
        const clave = `${c.paciente_id}|${c.fecha}|${c.hora_inicio}`;
        if (ocupados.has(clave)) {
            continue;
        }
        ocupados.add(clave);
        turnos.push({ ...c, id: turnos.length + 1 });
    }
    return turnos;
}

// Asigna estados y notas clínicas de forma determinística (siempre los mismos datos)
function asignarEstados(turnos) {
    const registros = [];
    const turnosDeHoy = turnos.filter((t) => t.offset === 0);

    const registrar = (turno, indice) => {
        const registro = {
            id: registros.length + 1,
            nota_clinica: NOTAS_CLINICAS[indice % NOTAS_CLINICAS.length],
            autor_id: turno.profesional_id,
            creado: `${turno.fecha}T${turno.hora_fin}-03:00`,
            modificado: null,
        };
        registros.push(registro);
        turno.registro_sesion_id = registro.id;
    };

    for (const turno of turnos) {
        turno.registro_sesion_id = null;

        if (turno.offset < 0) {
            if (turno.id % 6 === 0) {
                turno.estado_id = 3; // Cancelado
            } else if (turno.id % 9 === 0) {
                turno.estado_id = 2; // Confirmado pero sin nota cargada: queda pendiente de registrar
            } else {
                turno.estado_id = 4; // Realizado
                registrar(turno, turno.id);
            }
        } else if (turno.offset > 0) {
            turno.estado_id = turno.offset <= 2 && turno.id % 2 === 0 ? 2 : 1;
        }
    }

    // Hoy: los primeros realizados, uno cancelado, después confirmados y pendientes
    const n = turnosDeHoy.length;
    turnosDeHoy.forEach((turno, i) => {
        if (i === 2) {
            turno.estado_id = 3;
        } else if (i < Math.floor(n * 0.4)) {
            turno.estado_id = 4;
            registrar(turno, i);
        } else if (i < Math.floor(n * 0.7)) {
            turno.estado_id = 2;
        } else {
            turno.estado_id = 1;
        }
    });

    for (const turno of turnos) {
        delete turno.offset;
    }
    return registros;
}

// ------------------------------------------------------------
// Estado inicial completo de la API simulada
// ------------------------------------------------------------
export function crearDatosIniciales(hoy = hoyISO()) {
    const copiar = (valor) => JSON.parse(JSON.stringify(valor));

    const pacientes = PACIENTES.map((p, i) => ({
        id: p.id,
        nombre: p.nombre,
        apellido: p.apellido,
        dni: p.dni,
        fecha_nacimiento: p.nacimiento,
        direccion: `${CALLES[i % CALLES.length]} ${100 + p.id * 37}, Córdoba`,
        consentimiento: p.id !== 13,
        cud_vencimiento: sumarDias(hoy, p.cud),
        obra_social_id: p.os,
        numero_afiliado: p.afiliado,
        estado_id: p.estado,
    }));

    const vinculos = VINCULOS.map(([pacienteId, tutorId, parentescoId, principal], i) => ({
        id: i + 1,
        paciente_id: pacienteId,
        tutor_id: tutorId,
        parentesco_id: parentescoId,
        responsable_principal: principal,
    }));

    const asignaciones = ASIGNACIONES.map(([pacienteId, profesionalId, inicio, fin], i) => ({
        id: i + 1,
        paciente_id: pacienteId,
        profesional_id: profesionalId,
        fecha_inicio: sumarDias(hoy, inicio),
        fecha_fin: fin === null ? null : sumarDias(hoy, fin),
    }));

    const turnos = generarTurnos(hoy, asignaciones);
    const registros = asignarEstados(turnos);

    return {
        hoy,
        catalogos: copiar(CATALOGOS),
        obras_sociales: copiar(OBRAS_SOCIALES),
        usuarios: copiar(USUARIOS),
        profesionales: copiar(PROFESIONALES),
        pacientes,
        tutores: copiar(TUTORES),
        vinculos,
        asignaciones,
        turnos,
        registros,
    };
}
