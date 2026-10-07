-- ============================================================
-- EduGes - Datos de prueba
-- ============================================================
-- Personas y datos FICTICIOS para probar el sistema con las APIs reales.
-- Se corre DESPUÉS de docs/EduGes.sql. NO usar en producción.
--
-- Cómo correrlo (desde la raíz del repositorio):
--     psql -U postgres -d EduGes -f docs/datos-prueba.sql
--
-- - Se puede correr varias veces: lo que ya existe no se vuelve a cargar.
-- - Todo va en una transacción: si algo falla, no queda nada a medias.
-- - Los vencimientos del CUD y las asignaciones se calculan desde el día en que
--   se corre, así siempre hay CUD vencidos, por vencer y vigentes.
--
-- Usuarios nuevos (rol Profesional, contraseña de todos: Prueba1234):
--     carla.rios        Carla Ríos          Fonoaudiología
--     diego.fernandez   Diego Fernández     Psicología
--     valeria.martinez  Valeria Martínez    Terapia Ocupacional
-- Usuarios que ya trae EduGes.sql:
--     profesional.prueba / 123456     María Gómez (Psicopedagogo)
--     EduGes_Admin       / eduges123  SuperAdministrador
--
-- Pacientes por profesional (asignaciones vigentes):
--     María Gómez       6 pacientes (2 con CUD vencido, 2 por vencer, 2 vigentes)
--     Carla Ríos        3 pacientes (uno compartido con María)
--     Diego Fernández   2 pacientes
--     Valeria Martínez  2 pacientes
-- Además, María tiene una asignación TERMINADA con Joaquín Torres: no lo tiene que ver.
-- ============================================================

\set ON_ERROR_STOP on
-- El archivo está en UTF-8: sin esto, psql en Windows lo lee como WIN1252 y los acentos se guardan mal
\encoding UTF8

BEGIN;

-- ------------------------------------------------------------
-- Catálogos
-- ------------------------------------------------------------
INSERT INTO public.especialidades ("ID_Especialidad", "Especialidad") VALUES
    (2, 'Fonoaudiología'),
    (3, 'Psicología'),
    (4, 'Terapia Ocupacional')
ON CONFLICT DO NOTHING;

INSERT INTO public.tipos_obras_sociales ("ID_TipoOS", "Tipo") VALUES
    (1, 'Obra social'),
    (2, 'Prepaga'),
    (3, 'Particular')
ON CONFLICT DO NOTHING;

-- Esta tabla no tiene numeración automática: los IDs van fijos
INSERT INTO public.estados_obras_sociales ("ID_EstadoObraSocial", "Descripcion") VALUES
    (1, 'Activa'),
    (2, 'Inactiva')
ON CONFLICT DO NOTHING;

-- La obra social es obligatoria para todo paciente: "Particular" es para quien no tiene
INSERT INTO public.obras_sociales ("ID_ObraSocial", "Nombre", "Contacto", "Mail", "Web", "ID_TipoOS", "ID_EstadoObraSocial") VALUES
    (1, 'OSDE',          '0810-555-6733', 'prestadores@osde.ejemplo.com',  'https://www.osde.com.ar',          2, 1),
    (2, 'Swiss Medical', '0810-333-8876', 'prestadores@swiss.ejemplo.com', 'https://www.swissmedical.com.ar', 2, 1),
    (3, 'IOMA',          '0800-222-4662', 'prestadores@ioma.ejemplo.com',  'https://www.ioma.gba.gov.ar',     1, 1),
    (4, 'PAMI',          '138',           'prestadores@pami.ejemplo.com',  'https://www.pami.org.ar',         1, 1),
    (5, 'OSECAC',        '0810-666-7322', 'prestadores@osecac.ejemplo.com', 'https://www.osecac.org.ar',      1, 1),
    (6, 'Particular',    NULL,            NULL,                            NULL,                              3, 1)
ON CONFLICT DO NOTHING;

INSERT INTO public.parentescos ("ID_Parentesco", "Descripcion") VALUES
    (1, 'Madre'),
    (2, 'Padre'),
    (3, 'Abuela'),
    (4, 'Abuelo'),
    (5, 'Tía / Tío'),
    (6, 'Tutor/a legal')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- Usuarios y profesionales (contraseña: Prueba1234, con el hash de Django)
-- ------------------------------------------------------------
INSERT INTO public.usuarios ("ID_Usuario", "Usuario", "ID_Rol", "Password", "Activo") VALUES
    (4, 'carla.rios',       2, 'pbkdf2_sha256$1500000$fnUibwlXV5lMowhcmHeJhI$z0wjSCOkmvGp/+sj8eyW5bfVpoFmOTJc99j4ZRsqXQ0=', true),
    (5, 'diego.fernandez',  2, 'pbkdf2_sha256$1500000$fnUibwlXV5lMowhcmHeJhI$z0wjSCOkmvGp/+sj8eyW5bfVpoFmOTJc99j4ZRsqXQ0=', true),
    (6, 'valeria.martinez', 2, 'pbkdf2_sha256$1500000$fnUibwlXV5lMowhcmHeJhI$z0wjSCOkmvGp/+sj8eyW5bfVpoFmOTJc99j4ZRsqXQ0=', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.profesionales ("ID_Profesionales", "Nombre", "Apellido", "DNI", "Matricula", "ID_Especialidad",
                                  "Contacto", "Mail", "ID_Usuario", "ID_EstadoProfesional", "ID_Rol") VALUES
    (2, 'Carla',   'Ríos',      '31444555', 'MN-20456', 2, '1155667788', 'carla.rios@ejemplo.com',       4, 1, 2),
    (3, 'Diego',   'Fernández', '29888111', 'MP-30789', 3, '1144556677', 'diego.fernandez@ejemplo.com',  5, 1, 2),
    (4, 'Valeria', 'Martínez',  '33222777', 'MP-40112', 4, '1166778899', 'valeria.martinez@ejemplo.com', 6, 1, 2)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- Pacientes (todos menores; estado 1 = Activo)
-- El vencimiento del CUD se calcula desde hoy (negativo = ya venció)
-- ------------------------------------------------------------
INSERT INTO public.pacientes ("ID_Paciente", "Nombre", "Apellido", "DNI", "FechaNacimiento", "Direccion", "Mail",
                              "ID_ObraSocial", "NumeroAfiliado", "CUD_Numero", "CUD_Vencimiento",
                              "ID_EstadoPaciente", "Consentimiento")
SELECT v.id, v.nombre, v.apellido, v.dni, v.nacimiento::date, v.direccion, v.mail,
       v.obra_social, v.afiliado, v.cud_numero, CURRENT_DATE + v.dias_cud,
       1, true
FROM (VALUES
    ( 1, 'Lucas',     'Pérez',   '50111222', '2017-03-10', 'Av. Rivadavia 4520, CABA',       NULL,                         1, '61 234567 01', 'CUD-100201', -20),
    ( 2, 'Sofía',     'Ruiz',    '50333444', '2018-07-22', 'Calle 7 N° 1234, La Plata',      NULL,                         3, 'IOMA-778812',  'CUD-100202',  12),
    ( 3, 'Tomás',     'Díaz',    '49555666', '2016-11-05', 'Belgrano 890, Quilmes',          'flia.diaz@ejemplo.com',      2, 'SM-0045521',   'CUD-100203',  45),
    ( 4, 'Valentina', 'Herrera', '51777888', '2019-01-15', 'San Martín 230, Lanús',          NULL,                         4, 'PAMI-150099',  NULL,          200),
    ( 5, 'Benjamín',  'Herrera', '52999000', '2020-05-30', 'San Martín 230, Lanús',          NULL,                         4, 'PAMI-150100',  'CUD-100205', 320),
    ( 6, 'Martina',   'López',   '50222333', '2017-09-12', 'Mitre 1550, Avellaneda',         'martina.lopez@ejemplo.com',  6, 'PARTICULAR',   'CUD-100206',  -3),
    ( 7, 'Joaquín',   'Torres',  '49888777', '2015-12-01', 'Moreno 345, Banfield',           NULL,                         5, 'OSE-332211',   'CUD-100207',  90),
    ( 8, 'Emma',      'Castro',  '51444555', '2018-02-14', 'Alsina 1020, Lomas de Zamora',   NULL,                         1, '61 998877 02', 'CUD-100208',  25),
    ( 9, 'Mateo',     'Romero',  '50666777', '2017-06-08', 'Calle 12 N° 560, La Plata',      NULL,                         3, 'IOMA-445566',  'CUD-100209', 150),
    (10, 'Catalina',  'Suárez',  '52111999', '2019-10-19', 'Pueyrredón 2780, CABA',          'csuarez.flia@ejemplo.com',   2, 'SM-0099887',   NULL,          400),
    (11, 'Thiago',    'Acosta',  '49222111', '2016-04-27', 'Hipólito Yrigoyen 455, Lanús',   NULL,                         5, 'OSE-112233',   'CUD-100211',  58),
    (12, 'Olivia',    'Medina',  '51888999', '2018-12-03', 'Calle 50 N° 980, La Plata',      NULL,                         3, 'IOMA-990011',  'CUD-100212', 260)
) AS v(id, nombre, apellido, dni, nacimiento, direccion, mail, obra_social, afiliado, cud_numero, dias_cud)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- Asignaciones profesional ↔ paciente
-- FechaFin vacía = vigente (es lo que filtra GET /api/pacientes/ para un profesional)
-- ------------------------------------------------------------
INSERT INTO public.asignaciones_profesionales ("ID_AsignacionProfesional", "ID_Paciente", "ID_Profesional", "FechaInicio", "FechaFin")
SELECT v.id, v.paciente, v.profesional, CURRENT_DATE - v.desde, CASE WHEN v.hasta IS NULL THEN NULL ELSE CURRENT_DATE - v.hasta END
FROM (VALUES
    -- María Gómez (profesional 1)
    ( 1,  1, 1, 300, NULL),
    ( 2,  2, 1, 250, NULL),
    ( 3,  3, 1, 200, NULL),
    ( 4,  4, 1, 150, NULL),
    ( 5,  5, 1, 150, NULL),
    ( 6,  6, 1,  60, NULL),
    -- Asignación terminada: María ya no atiende a Joaquín
    ( 7,  7, 1, 400,   30),
    -- Carla Ríos (profesional 2): Tomás lo comparte con María
    ( 8,  3, 2, 120, NULL),
    ( 9,  7, 2,  25, NULL),
    (10,  8, 2,  90, NULL),
    -- Diego Fernández (profesional 3)
    (11,  9, 3, 180, NULL),
    (12, 10, 3,  45, NULL),
    -- Valeria Martínez (profesional 4)
    (13, 11, 4, 210, NULL),
    (14, 12, 4,  30, NULL)
) AS v(id, paciente, profesional, desde, hasta)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- Tutores y vínculos (un responsable principal por paciente)
-- ------------------------------------------------------------
INSERT INTO public.tutores ("ID_Tutor", "Nombre", "Apellido", "DNI", "Telefono", "Movil", "Mail", "Domicilio") VALUES
    ( 1, 'Laura',   'Pérez',   '28111222', NULL,          '1150112233', 'laura.perez@ejemplo.com',   'Av. Rivadavia 4520, CABA'),
    ( 2, 'Jorge',   'Pérez',   '27111333', NULL,          '1150114455', NULL,                        'Av. Rivadavia 4520, CABA'),
    ( 3, 'Ana',     'Ruiz',    '30222444', '2214567890',  '2215223344', 'ana.ruiz@ejemplo.com',      'Calle 7 N° 1234, La Plata'),
    ( 4, 'Roberto', 'Díaz',    '26555777', NULL,          '1152334455', 'flia.diaz@ejemplo.com',     'Belgrano 890, Quilmes'),
    ( 5, 'Claudia', 'Herrera', '31777999', '1142417788',  '1153445566', 'claudia.herrera@ejemplo.com','San Martín 230, Lanús'),
    ( 6, 'Marta',   'López',   '22333444', '1142019988',  '1154556677', NULL,                        'Mitre 1550, Avellaneda'),
    ( 7, 'Silvia',  'Torres',  '29888666', NULL,          '1155667788', 'silvia.torres@ejemplo.com', 'Moreno 345, Banfield'),
    ( 8, 'Pablo',   'Castro',  '30444555', NULL,          '1156778899', NULL,                        'Alsina 1020, Lomas de Zamora'),
    ( 9, 'Lorena',  'Romero',  '32666888', NULL,          '2215889900', 'lorena.romero@ejemplo.com', 'Calle 12 N° 560, La Plata'),
    (10, 'Gustavo', 'Suárez',  '28999111', '1148223344',  '1157990011', 'csuarez.flia@ejemplo.com',  'Pueyrredón 2780, CABA'),
    (11, 'Elena',   'Acosta',  '25222333', NULL,          '1158001122', NULL,                        'Hipólito Yrigoyen 455, Lanús'),
    (12, 'Natalia', 'Medina',  '33888000', NULL,          '2216112233', 'natalia.medina@ejemplo.com','Calle 50 N° 980, La Plata')
ON CONFLICT DO NOTHING;

-- Parentescos: 1 Madre, 2 Padre, 3 Abuela, 5 Tía/Tío, 6 Tutor/a legal
INSERT INTO public.pacientes_tutores ("ID_PacienteTutor", "ID_Paciente", "ID_Tutor", "ID_Parentesco", "ResponsablePrincipal") VALUES
    ( 1,  1,  1, 1, true),
    ( 2,  1,  2, 2, false),
    ( 3,  2,  3, 1, true),
    ( 4,  3,  4, 2, true),
    -- Valentina y Benjamín son hermanos: comparten la madre
    ( 5,  4,  5, 1, true),
    ( 6,  5,  5, 1, true),
    ( 7,  6,  6, 3, true),
    ( 8,  7,  7, 1, true),
    ( 9,  8,  8, 2, true),
    (10,  9,  9, 1, true),
    (11, 10, 10, 2, true),
    (12, 11, 11, 6, true),
    (13, 12, 12, 1, true)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- Numeración automática: que el próximo ID siga después de los cargados
-- (si no, el próximo alta desde la aplicación chocaría con un ID existente)
-- ------------------------------------------------------------
SELECT setval('public.especialidades_id_especialidad_seq',                   (SELECT max("ID_Especialidad")          FROM public.especialidades));
SELECT setval('public.tipos_obras_sociales_id_tipoos_seq',                   (SELECT max("ID_TipoOS")                FROM public.tipos_obras_sociales));
SELECT setval('public.obras_sociales_id_obrasocial_seq',                     (SELECT max("ID_ObraSocial")            FROM public.obras_sociales));
SELECT setval('public.parentescos_id_parentesco_seq',                        (SELECT max("ID_Parentesco")            FROM public.parentescos));
SELECT setval('public.usuarios_id_usuario_seq',                              (SELECT max("ID_Usuario")               FROM public.usuarios));
SELECT setval('public.profesionales_id_profesional_seq',                     (SELECT max("ID_Profesionales")         FROM public.profesionales));
SELECT setval('public.pacientes_id_paciente_seq',                            (SELECT max("ID_Paciente")              FROM public.pacientes));
SELECT setval('public.asignaciones_profesionales_id_asignacionprofesional_seq', (SELECT max("ID_AsignacionProfesional") FROM public.asignaciones_profesionales));
SELECT setval('public.tutores_id_tutor_seq',                                 (SELECT max("ID_Tutor")                 FROM public.tutores));
SELECT setval('public.pacientes_tutores_id_pacientetutor_seq',               (SELECT max("ID_PacienteTutor")         FROM public.pacientes_tutores));

COMMIT;

-- ------------------------------------------------------------
-- Resumen
-- ------------------------------------------------------------
SELECT 'obras sociales' AS tabla, count(*) AS filas FROM public.obras_sociales
UNION ALL SELECT 'parentescos',    count(*) FROM public.parentescos
UNION ALL SELECT 'especialidades', count(*) FROM public.especialidades
UNION ALL SELECT 'profesionales',  count(*) FROM public.profesionales
UNION ALL SELECT 'pacientes',      count(*) FROM public.pacientes
UNION ALL SELECT 'asignaciones',   count(*) FROM public.asignaciones_profesionales
UNION ALL SELECT 'tutores',        count(*) FROM public.tutores;
