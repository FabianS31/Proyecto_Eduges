# EduGes — Contrato de la API REST

> **Estado:** BORRADOR v0.3 (27/09/2026) — propuesta del frontend, **pendiente de revisión del backend**.
> Cambios respecto de la versión anterior: ver §13.
> Todo lo marcado con ⚠️ es una decisión abierta que hay que confirmar entre los dos.

Este documento define qué endpoints expone el backend (Django + DRF) y qué forma tiene el JSON
que entra y sale. El frontend (HTML/CSS/JS) se desarrolla contra este contrato usando datos
simulados (mocks) hasta que la API real esté lista; por eso **cualquier cambio de nombres o
formatos tiene que reflejarse acá primero**.

---

## 1. Convenciones generales

### 1.1 Base y formato
- Prefijo: todas las rutas empiezan con `/api/`. Todas terminan en `/` (estilo Django).
- Cuerpo de requests y responses: `application/json; charset=utf-8`.
- Claves JSON en `snake_case` y en español, igual que los campos de los modelos
  (`fecha_nacimiento`, `cud_vencimiento`, `numero_afiliado`).
- La clave primaria de cualquier recurso se expone siempre como **`id`**
  (no `id_paciente`, `ID_Turnos`, etc.). En DRF: `id = serializers.IntegerField(source='id_paciente', read_only=True)`.

### 1.2 Tipos de datos
| Tipo | Formato | Ejemplo |
|---|---|---|
| Fecha | ISO 8601 `YYYY-MM-DD` | `"2026-09-26"` |
| Hora | `HH:MM:SS` (formato por defecto de DRF) | `"14:30:00"` |
| Fecha y hora | ISO 8601 con zona | `"2026-09-26T14:30:00-03:00"` |
| Booleano | `true` / `false` | |
| Vacío | `null` (nunca `""` para "sin dato") | |

El frontend se encarga de mostrar las fechas como `dd/mm/aaaa`; la API siempre usa ISO.

### 1.3 Relaciones (claves foráneas)
- **Lectura:** la relación viene como objeto chico con `id` y el texto a mostrar, para no tener
  que hacer una segunda llamada.
  ```json
  "estado": { "id": 1, "nombre": "Activo" }
  ```
- **Escritura:** se manda solo el id con sufijo `_id`.
  ```json
  { "estado_id": 1 }
  ```
- Para todos los catálogos el texto se llama `nombre`, aunque en la BD la columna se llame
  `Estado`, `Descripcion`, `Tipo`, `Rol` o `Especialidad`.

### 1.4 Paginación (listados grandes)
Paginación por número de página de DRF (`PageNumberPagination`), `page_size = 20`,
modificable con `?page_size=` (máximo 100).

```json
{
  "count": 57,
  "next": "/api/pacientes/?page=3",
  "previous": "/api/pacientes/?page=1",
  "results": [ ... ]
}
```
Los catálogos y los listados de un solo día (agenda) **no** se paginan: devuelven un array directo.

### 1.5 Errores
Se usa el formato por defecto de DRF, para que el backend no tenga que personalizar nada.

| Código | Cuándo | Cuerpo |
|---|---|---|
| `400` | Validación fallida | `{ "campo": ["mensaje"], "non_field_errors": ["mensaje"] }` |
| `401` | No hay sesión iniciada o expiró | `{ "detail": "..." }` |
| `403` | Hay sesión pero el rol no tiene permiso, o el recurso no le pertenece | `{ "detail": "..." }` |
| `404` | No existe (o el usuario no puede saber que existe) | `{ "detail": "..." }` |
| `405` | Método no permitido | `{ "detail": "..." }` |
| `409` | Conflicto de negocio (turno superpuesto, DNI duplicado) | `{ "detail": "...", "codigo": "turno_superpuesto" }` |
| `429` | Demasiados intentos de login | `{ "detail": "...", "reintentar_en": 60 }` |
| `500` | Error interno | sin cuerpo garantizado |

Códigos de conflicto (`409`), en el campo `codigo`, para que el frontend reaccione sin depender del texto:

| `codigo` | Endpoint | Cuándo |
|---|---|---|
| `dni_duplicado` | Alta/edición de paciente o profesional | Ya existe otro con ese DNI |
| `tutor_ya_vinculado` | `POST /api/pacientes/{id}/tutores/` | Ese tutor ya está vinculado a ese paciente |
| `turno_superpuesto` | Alta/reprogramación de turno | El profesional o el paciente ya tienen un turno no cancelado en ese horario |
| `sesion_existente` | `POST /api/turnos/{id}/sesion/` | El turno ya tiene nota clínica (usar `PATCH`) |
| `asignacion_duplicada` | `POST /api/asignaciones/` | Ya hay una asignación vigente para ese paciente y profesional |
| `obra_social_duplicada` | Alta/edición de obra social | Ya existe una con ese nombre (sin distinguir mayúsculas ni acentos) |

Los mensajes de error van **en español y listos para mostrar al usuario**.
Qué hace el frontend: `400` marca los campos del formulario, `401` redirige al login,
`403`/`404`/`409` muestran un aviso, `500` muestra "Ocurrió un error, intentá de nuevo".

### 1.6 Autenticación y CSRF
- Sesión con cookie de Django (`sessionid`, `HttpOnly`) y protección CSRF.
- El frontend lee la cookie `csrftoken` y la manda en el header `X-CSRFToken` en todo
  `POST`, `PATCH`, `PUT` y `DELETE`. Las requests usan `credentials: 'same-origin'`.
- Frontend y API se sirven desde el mismo origen (el mismo `runserver`), así que no hace falta CORS.
- La autenticación corre sobre la tabla propia `usuarios` (no `auth_user`).
  ⚠️ DRF por defecto importa `contrib.auth`: configurar `UNAUTHENTICATED_USER = None` y una
  clase de autenticación propia.
- ⚠️ Pendiente: sesiones en tabla `django_session` o con cookies firmadas.

### 1.7 Borrados
No se borran datos clínicos ni personas. Pacientes y profesionales se dan de baja cambiando
el estado (`PATCH`). Solo tienen `DELETE` los vínculos (paciente↔tutor) y los catálogos sin uso.

---

## 2. Roles y permisos

Dos roles (tabla `roles`): **Administrador** (`id` 1) y **Profesional** (`id` 2).

Códigos de permiso propuestos para la tabla `permisos` (columna `Permiso`, máx. 20 caracteres).
`/api/auth/me/` devuelve la lista para que el frontend oculte menús y botones.
**La validación real siempre la hace el backend.**

| Código | Descripción | Admin | Profesional |
|---|---|:-:|:-:|
| `dashboard.ver` | Ver el dashboard | ✅ | ✅ (solo lo suyo) |
| `pacientes.ver` | Ver pacientes | ✅ todos | ✅ solo asignados |
| `pacientes.editar` | Alta y modificación de pacientes y tutores | ✅ | ❌ ⚠️ |
| `turnos.ver` | Ver agenda y turnos | ✅ todos | ✅ solo los suyos |
| `turnos.editar` | Crear, reprogramar y cambiar estado de turnos | ✅ | ✅ solo los suyos ⚠️ |
| `sesiones.registrar` | Cargar la nota clínica de un turno | ❌ ⚠️ | ✅ solo sus turnos |
| `sesiones.ver` | Leer notas clínicas | ⚠️ | ✅ solo sus pacientes |
| `profesionales.ver` | Ver el listado de profesionales | ✅ | ✅ |
| `profesionales.edit` | ABM de profesionales y asignaciones | ✅ | ❌ |
| `obras_sociales.edit` | ABM de obras sociales | ✅ | ❌ |
| `usuarios.admin` | ABM de usuarios y roles | ✅ | ❌ |

⚠️ A definir con el equipo/cliente: ¿el administrador puede leer notas clínicas? ¿el
profesional puede dar de alta pacientes o turnos?
Mientras no se defina, la API simulada del frontend usa la opción más restrictiva: el
Administrador **no** tiene `sesiones.ver` ni `sesiones.registrar`, y el Profesional **no** tiene
`pacientes.editar` (sí `turnos.editar`, limitado a su propia agenda).

**Pertenencia (Profesional):** un paciente es "suyo" si tiene una asignación **vigente** con él.
Si pide un recurso ajeno la API responde `404` (no `403`), para no revelar que existe.

**Asignación vigente:** `fecha_fin` nula, o `fecha_fin` **igual o posterior a hoy**. La fecha de fin
es el último día de la asignación y cuenta como vigente (una asignación que termina hoy sigue
vigente hasta el final del día). En SQL: `"FechaFin" IS NULL OR "FechaFin" >= CURRENT_DATE`.
El campo `vigente` de las respuestas y el filtro `?vigentes=true` usan esta misma regla.

---

## 3. Autenticación — `/api/auth/`

### `GET /api/auth/csrf/`
Deja la cookie `csrftoken` (vista con `@ensure_csrf_cookie`). El login la llama antes de enviar el formulario.
**Respuesta `204`**, sin cuerpo.

### `POST /api/auth/login/`
```json
{ "usuario": "msoto", "password": "********", "recordar": true }
```
- `recordar: false` → la sesión expira al cerrar el navegador. `true` → dura ⚠️ 14 días.
- **`200`** → mismo cuerpo que `/api/auth/me/`.
- **`400`** → `{ "non_field_errors": ["Usuario o contraseña incorrectos."] }`
  (mensaje genérico: no revelar si el usuario existe).
- **`429`** → demasiados intentos: después de **5 intentos fallidos** el login queda bloqueado
  **60 segundos**. El cuerpo trae `reintentar_en` con los segundos que faltan. Un login correcto
  reinicia el contador.

### `POST /api/auth/logout/`
Cierra la sesión. **`204`**.

### `GET /api/auth/me/`
Devuelve el usuario logueado. El frontend lo llama al cargar cada página para armar la barra
superior y el menú. **`401`** si no hay sesión.
```json
{
  "id": 3,
  "usuario": "msoto",
  "rol": { "id": 2, "nombre": "Profesional" },
  "profesional": {
    "id": 5,
    "nombre": "Mariana",
    "apellido": "Soto",
    "especialidad": { "id": 1, "nombre": "Psicología Pediátrica" }
  },
  "permisos": ["dashboard.ver", "pacientes.ver", "turnos.ver", "turnos.editar",
               "sesiones.registrar", "sesiones.ver", "profesionales.ver"]
}
```
Para un administrador sin profesional asociado: `"profesional": null`.

### `POST /api/auth/cambiar-password/` *(fase 2)*
```json
{ "password_actual": "...", "password_nuevo": "...", "password_nuevo_confirmacion": "..." }
```
**`204`** o **`400`** con los errores de validación:
- `password_actual`: "La contraseña actual es incorrecta."
- `password_nuevo`: mínimo 8 caracteres (misma regla para toda contraseña nueva: alta de
  profesional, alta de usuario y reseteo).
- `password_nuevo_confirmacion`: "Las contraseñas no coinciden."

---

## 4. Catálogos — `/api/catalogos/`

### `GET /api/catalogos/`
Todos los catálogos chicos en una sola llamada, para llenar los `<select>` de los formularios.
Sin paginar. El frontend lo guarda en memoria durante la sesión.
```json
{
  "estados_turnos":        [{ "id": 1, "nombre": "Pendiente" }, { "id": 2, "nombre": "Confirmado" },
                            { "id": 3, "nombre": "Cancelado" }, { "id": 4, "nombre": "Realizado" }],
  "estados_pacientes":     [{ "id": 1, "nombre": "Activo" }, { "id": 2, "nombre": "Inactivo" }],
  "estados_profesionales": [{ "id": 1, "nombre": "Activo" }],
  "especialidades":        [{ "id": 1, "nombre": "Psicología Pediátrica" }],
  "parentescos":           [{ "id": 1, "nombre": "Madre" }],
  "tipos_obras_sociales":  [{ "id": 1, "nombre": "Prepaga" }],
  "estados_obras_sociales":[{ "id": 1, "nombre": "Activa" }],
  "obras_sociales":        [{ "id": 1, "nombre": "OSDE" }],
  "roles":                 [{ "id": 1, "nombre": "Administrador" }, { "id": 2, "nombre": "Profesional" }]
}
```
- `obras_sociales` acá trae solo las activas y solo `id` + `nombre` (el ABM completo está en §8).
- Hoy solo tienen datos `estados_turnos`, `estados_pacientes` y `roles`; el resto hay que cargarlo (T1.4).

**IDs fijos en los que se apoya el frontend** (no cambiarlos en la BD):
- `estados_turnos`: 1 Pendiente · 2 Confirmado · 3 Cancelado · 4 Realizado
- `estados_pacientes`: 1 Activo · 2 Inactivo
- `roles`: 1 Administrador · 2 Profesional

---

## 5. Dashboard — `/api/dashboard/`

### `GET /api/dashboard/resumen/?fecha=2026-09-26`
`fecha` es opcional (por defecto, hoy). Para un Profesional, todos los números se calculan
solo sobre sus turnos y pacientes.
```json
{
  "fecha": "2026-09-26",
  "turnos": {
    "total": 8,
    "pendientes": 2,
    "confirmados": 3,
    "realizados": 2,
    "cancelados": 1
  },
  "pacientes_activos": 42,
  "profesionales_activos": 6,
  "alertas_cud": 3
}
```
- `realizados` = estado **Realizado** (hoy el código cuenta Confirmados por error).
- `pacientes_activos` = estado **Activo** (hoy cuenta todos).
- `alertas_cud` = pacientes activos con CUD vencido o que vence en los próximos 60 días
  (misma regla que `/api/pacientes/cud-por-vencer/`).
- `profesionales_activos` solo es relevante para el Admin; para un Profesional puede venir `null`.

El dashboard además usa:
- la agenda del día: `GET /api/turnos/?fecha=2026-09-26` (§7);
- el panel de CUD: `GET /api/pacientes/cud-por-vencer/?dias=60&limite=5` (§6).

---

## 6. Pacientes — `/api/pacientes/`

### Objeto `Paciente` (detalle)
```json
{
  "id": 12,
  "nombre": "Lucas",
  "apellido": "Pérez",
  "dni": "50123456",
  "fecha_nacimiento": "2018-04-10",
  "edad": 8,
  "direccion": "Av. Siempre Viva 742",
  "consentimiento": true,
  "cud_vencimiento": "2026-11-15",
  "cud_estado": "por_vencer",
  "obra_social": { "id": 3, "nombre": "OSDE" },
  "numero_afiliado": "123456789",
  "estado": { "id": 1, "nombre": "Activo" },
  "tutores": [
    {
      "vinculo_id": 20,
      "tutor": {
        "id": 7, "nombre": "Laura", "apellido": "Gómez",
        "telefono_fijo": null, "telefono_movil": "3511234567", "mail": "laura@mail.com"
      },
      "parentesco": { "id": 1, "nombre": "Madre" },
      "responsable_principal": true
    }
  ],
  "profesionales_asignados": [
    { "asignacion_id": 4, "profesional": { "id": 5, "nombre": "Mariana", "apellido": "Soto" },
      "fecha_inicio": "2026-03-01", "fecha_fin": null }
  ]
}
```
Campos calculados (solo lectura):
- `edad`: años cumplidos a hoy.
- `cud_estado`: `"vigente"` | `"por_vencer"` (60 días o menos) | `"vencido"`.

### `GET /api/pacientes/`
Listado **paginado**. Cada ítem es una versión reducida:
```json
{
  "id": 12, "nombre": "Lucas", "apellido": "Pérez", "dni": "50123456", "edad": 8,
  "obra_social": { "id": 3, "nombre": "OSDE" },
  "estado": { "id": 1, "nombre": "Activo" },
  "cud_vencimiento": "2026-11-15", "cud_estado": "por_vencer",
  "tutor_principal": { "nombre": "Laura Gómez", "telefono_movil": "3511234567" }
}
```
Filtros (todos opcionales, combinables):
| Parámetro | Ejemplo | Efecto |
|---|---|---|
| `q` | `?q=perez` | Busca en nombre, apellido y DNI |
| `estado` | `?estado=1` | Por id de estado |
| `profesional` | `?profesional=5` | Con asignación vigente a ese profesional (solo Admin) |
| `obra_social` | `?obra_social=3` | |
| `cud_estado` | `?cud_estado=vencido` | `vigente` / `por_vencer` / `vencido` |
| `ordering` | `?ordering=apellido` | `apellido`, `-apellido`, `cud_vencimiento` |
| `page`, `page_size` | | Paginación |

Orden por defecto: `apellido`, `nombre`.

### `GET /api/pacientes/{id}/`
Detalle completo (objeto de arriba).

### `POST /api/pacientes/`
```json
{
  "nombre": "Lucas", "apellido": "Pérez", "dni": "50123456",
  "fecha_nacimiento": "2018-04-10", "direccion": "Av. Siempre Viva 742",
  "consentimiento": true, "cud_vencimiento": "2026-11-15",
  "obra_social_id": 3, "numero_afiliado": "123456789", "estado_id": 1
}
```
- **`201`** → objeto `Paciente` completo.
- **`400`** → validación. Reglas mínimas: obligatorios según la BD; `dni` de 7 u 8 dígitos
  numéricos; `fecha_nacimiento` no futura.
- **`409`** `{ "codigo": "dni_duplicado" }` si ya existe un paciente con ese DNI.

### `PATCH /api/pacientes/{id}/`
Mismos campos que el alta, todos opcionales. Dar de baja = `{ "estado_id": 2 }`.
**`200`** → objeto completo.

### `GET /api/pacientes/cud-por-vencer/?dias=60&limite=5`
Pacientes activos con CUD vencido o que vence dentro de `dias` (por defecto 60), ordenados
por `cud_vencimiento` ascendente. `limite` es opcional. Sin paginar.
```json
[
  { "id": 12, "nombre": "Lucas", "apellido": "Pérez",
    "cud_vencimiento": "2026-11-15", "cud_estado": "por_vencer", "dias_restantes": 50,
    "tutor_principal": { "nombre": "Laura Gómez", "telefono_movil": "3511234567" } }
]
```

### Tutores del paciente
| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/api/pacientes/{id}/tutores/` | — | array de vínculos (como `tutores` en el detalle) |
| `POST` | `/api/pacientes/{id}/tutores/` | ver abajo | `201` vínculo |
| `PATCH` | `/api/pacientes/{id}/tutores/{vinculo_id}/` | `parentesco_id`, `responsable_principal` | `200` vínculo |
| `DELETE` | `/api/pacientes/{id}/tutores/{vinculo_id}/` | — | `204` (borra el vínculo, no al tutor) |

`POST`: vincular un tutor existente **o** crearlo en el momento:
```json
{ "tutor_id": 7, "parentesco_id": 1, "responsable_principal": true }
```
```json
{
  "tutor": { "nombre": "Laura", "apellido": "Gómez", "telefono_fijo": null,
             "telefono_movil": "3511234567", "mail": "laura@mail.com" },
  "parentesco_id": 1, "responsable_principal": true
}
```
Reglas:
- Como máximo un `responsable_principal: true` por paciente. Si se marca uno nuevo, el
  anterior pasa a `false` automáticamente (también en el `PATCH`).
- Hay que mandar `tutor_id` **o** `tutor`. Sin ninguno de los dos: `400` `{ "tutor_id": ["Este campo es obligatorio."] }`.
- Los errores del tutor nuevo vienen anidados: `{ "tutor": { "nombre": ["..."] } }`.
- Si ese tutor ya está vinculado al paciente: `409` `{ "codigo": "tutor_ya_vinculado" }`.

### `GET /api/tutores/?q=gomez`
Buscar tutores existentes (por ejemplo, para hermanos). Array de hasta 20 tutores. Sin paginar.
`PATCH /api/tutores/{id}/` edita los datos de contacto.

---

## 7. Turnos — `/api/turnos/`

### Objeto `Turno`
```json
{
  "id": 101,
  "fecha": "2026-09-26",
  "hora_inicio": "09:00:00",
  "hora_fin": "09:45:00",
  "estado": { "id": 1, "nombre": "Pendiente" },
  "paciente": {
    "id": 12, "nombre": "Lucas", "apellido": "Pérez", "dni": "50123456",
    "obra_social": { "id": 3, "nombre": "OSDE" }, "cud_estado": "por_vencer"
  },
  "profesional": { "id": 5, "nombre": "Mariana", "apellido": "Soto" },
  "tiene_registro_sesion": false
}
```
- **Nunca** incluye el texto de la nota clínica: solo `tiene_registro_sesion`.
- ⚠️ **Discrepancia a resolver:** el DER nuevo tiene `HoraInicio` y `HoraFin`, pero la BD y el
  modelo actuales tienen una sola columna `Hora`. El contrato usa `hora_inicio` / `hora_fin`
  (la agenda necesita saber la duración). Si se mantiene una sola columna: `hora_inicio` = `Hora`
  y `hora_fin` = `null`, y el frontend asume 45 minutos.

### `GET /api/turnos/`
| Parámetro | Ejemplo | Efecto |
|---|---|---|
| `fecha` | `?fecha=2026-09-26` | Un día (agenda diaria, dashboard) |
| `desde` / `hasta` | `?desde=2026-09-22&hasta=2026-09-28` | Rango (agenda semanal), máx. 31 días |
| `profesional` | `?profesional=5` | Solo Admin; al Profesional se le fuerza el suyo |
| `paciente` | `?paciente=12` | Historial de turnos de un paciente |
| `estado` | `?estado=1,2` | Uno o varios ids separados por coma |

- Hay que mandar `fecha`, o `desde` + `hasta`, o `paciente`. Si no, `400`.
- Con `fecha` o un rango: array sin paginar, ordenado por `fecha`, `hora_inicio`.
- Con solo `paciente`: paginado, del más reciente al más viejo.

### `GET /api/turnos/{id}/`
Objeto `Turno`.

### `POST /api/turnos/`
```json
{
  "fecha": "2026-09-26", "hora_inicio": "09:00:00", "hora_fin": "09:45:00",
  "paciente_id": 12, "profesional_id": 5, "estado_id": 1
}
```
- `estado_id` es opcional (por defecto 1, Pendiente). Un turno nuevo **solo** puede crearse
  Pendiente (1) o Confirmado (2).
- Las horas se aceptan como `HH:MM` o `HH:MM:SS`; la respuesta siempre usa `HH:MM:SS`.
- **`201`** → objeto `Turno`.
- **`400`**:
  - `fecha`: fecha pasada;
  - `hora_fin`: menor o igual que `hora_inicio`;
  - `paciente_id`: paciente inactivo, o (para un Profesional) paciente sin asignación vigente con él;
  - `profesional_id`: profesional que no está Activo (ej.: de licencia);
  - `estado_id`: distinto de Pendiente o Confirmado.
- **`403`** si un Profesional intenta crear un turno en la agenda de otro profesional.
- **`409`** `{ "codigo": "turno_superpuesto" }` si el profesional o el paciente ya tienen un
  turno no cancelado que se superpone.
- ⚠️ ¿Se exige que el paciente tenga una asignación vigente con ese profesional?

### `PATCH /api/turnos/{id}/`
Reprogramar (`fecha`, `hora_inicio`, `hora_fin`, `profesional_id`) o cambiar el estado (`estado_id`).
Transiciones de estado permitidas:
```
Pendiente → Confirmado | Cancelado
Confirmado → Realizado | Cancelado
Realizado, Cancelado → (finales, no cambian)
```
Una transición inválida devuelve `400` `{ "estado_id": ["No se puede pasar de Realizado a Pendiente."] }`.

Otras reglas del `PATCH`:
- No se puede marcar como **Realizado** un turno de fecha futura → `400` en `estado_id`.
- No se puede **reprogramar** un turno Cancelado o Realizado → `400` en `non_field_errors`.
- Al reprogramar se aplican las mismas validaciones que en el alta (fecha pasada solo si cambia
  la fecha, horario, profesional activo, superposición → `409`).
- Solo el Administrador puede cambiar el `profesional_id` → `403` para un Profesional.
- Un turno cancelado deja de ocupar el horario: se puede dar otro turno en ese lugar.

### Registro de sesión (nota clínica)
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/turnos/{id}/sesion/` | Lee la nota. `404` si no hay |
| `POST` | `/api/turnos/{id}/sesion/` | Crea la nota (una sola por turno) |
| `PATCH` | `/api/turnos/{id}/sesion/` | Corrige la nota ⚠️ (¿se permite editar? ¿con historial?) |

`POST`:
```json
{ "nota_clinica": "Texto de hasta 5000 caracteres...", "marcar_realizado": true }
```
- `nota_clinica` es obligatoria, no puede estar en blanco y tiene un máximo de 5000 caracteres.
- `marcar_realizado` es opcional (por defecto `false`). Con `true`, el turno pasa a Realizado en
  la misma operación (transacción).
- Solo el profesional del turno puede registrar o corregir la nota → `403` para cualquier otro.
- Solo si el turno está Confirmado o Realizado, y su fecha no es futura → `400` en `non_field_errors`.
- Si el turno ya tiene nota → `409` `{ "codigo": "sesion_existente" }`; para corregirla se usa `PATCH`.
- **`201`**:
```json
{
  "turno_id": 101,
  "nota_clinica": "Texto...",
  "autor": { "id": 5, "nombre": "Mariana", "apellido": "Soto" },
  "creado": "2026-09-26T09:50:12-03:00",
  "modificado": null
}
```
- ⚠️ `autor`, `creado` y `modificado` requieren agregar columnas a `registros_de_sesiones`
  (tarea T1.7). Mientras no existan, vienen como `null`.

---

## 8. Profesionales, asignaciones y obras sociales

### Profesionales — `/api/profesionales/`
Objeto:
```json
{
  "id": 5, "nombre": "Mariana", "apellido": "Soto", "dni": "30111222",
  "matricula": "MP 1234", "especialidad": { "id": 1, "nombre": "Psicología Pediátrica" },
  "contacto": "3517654321", "mail": "msoto@rinconpsi.com",
  "estado": { "id": 1, "nombre": "Activo" },
  "usuario": { "id": 3, "usuario": "msoto" },
  "pacientes_asignados": 9
}
```
| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| `GET` | `/api/profesionales/` | `profesionales.ver` | Paginado. Filtros `q`, `especialidad`, `estado` |
| `GET` | `/api/profesionales/{id}/` | `profesionales.ver` | Un Profesional no ve `dni` ni `usuario` de otros |
| `POST` | `/api/profesionales/` | `profesionales.edit` | Crea el profesional **y su usuario** en una transacción |
| `PATCH` | `/api/profesionales/{id}/` | `profesionales.edit` | Baja = `{ "estado_id": <inactivo> }` |

`POST`:
```json
{
  "nombre": "Mariana", "apellido": "Soto", "dni": "30111222", "matricula": "MP 1234",
  "especialidad_id": 1, "contacto": "3517654321", "mail": "msoto@rinconpsi.com",
  "estado_id": 1,
  "usuario": { "usuario": "msoto", "password": "contraseña-inicial" }
}
```
El usuario se crea con rol Profesional (2). La contraseña se guarda hasheada y **nunca** se
devuelve en ninguna respuesta.

### Asignaciones — `/api/asignaciones/`
```json
{
  "id": 4,
  "paciente": { "id": 12, "nombre": "Lucas", "apellido": "Pérez" },
  "profesional": { "id": 5, "nombre": "Mariana", "apellido": "Soto" },
  "fecha_inicio": "2026-03-01", "fecha_fin": null, "vigente": true
}
```
| Método | Ruta | Notas |
|---|---|---|
| `GET` | `/api/asignaciones/?paciente=12&profesional=5&vigentes=true` | Sin paginar |
| `POST` | `/api/asignaciones/` | `{ "paciente_id", "profesional_id", "fecha_inicio" }` |
| `PATCH` | `/api/asignaciones/{id}/` | Finalizar = `{ "fecha_fin": "2026-09-30" }` |

- `vigente` se calcula con la regla de §2 (fecha de fin inclusive). El frontend, al "Finalizar",
  manda `fecha_fin` = hoy: la asignación figura como vigente ("Hasta dd/mm/aaaa") hasta el final del día.
- `fecha_fin` no puede ser anterior a `fecha_inicio` → `400` en `fecha_fin`.
- Lectura: el Administrador ve todas las asignaciones; un Profesional, solo las suyas
  (con `?profesional=` de otro recibe una lista vacía).
- Escritura (`POST`/`PATCH`): solo con `profesionales.edit`.

`409` `{ "codigo": "asignacion_duplicada" }` si ya hay una asignación vigente para el mismo
paciente y profesional.

### Obras sociales — `/api/obras-sociales/`
```json
{
  "id": 3, "nombre": "OSDE", "contacto": "0810-555-6733", "mail": null,
  "web": "https://www.osde.com.ar",
  "tipo": { "id": 1, "nombre": "Prepaga" }, "estado": { "id": 1, "nombre": "Activa" }
}
```
`GET` (lista, sin paginar, filtro `?estado=`), `GET {id}`, `POST`, `PATCH`. Escritura solo con `obras_sociales.edit`.
Nombre repetido (sin distinguir mayúsculas ni acentos) → `409` `{ "codigo": "obra_social_duplicada" }`.
Un paciente no puede darse de alta ni pasarse a una obra social dada de baja → `400` en `obra_social_id`.
⚠️ En la BD `ID_ObraSocial` es obligatorio en `pacientes`: hace falta una fila
**"Particular / Sin obra social"** en `obras_sociales` para los pacientes sin cobertura.

---

## 9. Usuarios — `/api/usuarios/` *(fase 2, solo Admin)*

```json
{ "id": 3, "usuario": "msoto", "rol": { "id": 2, "nombre": "Profesional" },
  "profesional": { "id": 5, "nombre": "Mariana", "apellido": "Soto" } }
```
| Método | Ruta | Notas |
|---|---|---|
| `GET` | `/api/usuarios/` | Sin paginar |
| `POST` | `/api/usuarios/` | `{ "usuario", "password", "rol_id" }` (para crear otro Admin) |
| `PATCH` | `/api/usuarios/{id}/` | `rol_id` |
| `POST` | `/api/usuarios/{id}/resetear-password/` | `{ "password_nuevo" }` → `204` |

Reglas:
- `usuario` único → `400` `{ "usuario": ["Ya existe un usuario con ese nombre."] }`.
- Contraseñas: mínimo 8 caracteres.
- Un administrador no puede cambiar su propio rol (para no quedarse sin acceso) → `400` en `rol_id`.

---

## 10. Fuera de alcance por ahora (fase 3)
- **Programación recurrente de turnos:** tablas `Programaciones_Turnos`,
  `Programaciones_Turnos_Dias` y `Dias_Semana`, que hoy solo existen en
  `Scripts para DB - EduGes.txt`. Se agregará `/api/programaciones/` con un endpoint que genere
  los turnos de un rango.
- Recuperación de contraseña por mail.
- Auditoría / log de accesos.

---

## 11. Discrepancias detectadas entre el DER, la BD y los modelos

| # | Tema | DER (PNG v5) | BD (`EduGes.sql`) / modelo | Propuesta |
|---|---|---|---|---|
| 1 | Hora del turno | `HoraInicio`, `HoraFin` | `Hora` | Usar las dos columnas (ver §7) |
| 2 | Teléfonos del tutor | `Telefono`, `Movil` | `TelefonoFijo`, `TelefonoMovil` | La API usa `telefono_fijo` / `telefono_movil` |
| 3 | PK de turnos | `ID_Turno` | `ID_Turnos` | Indiferente: la API expone `id` |
| 4 | PK de profesionales | `ID_Profesional` | `ID_Profesionales` (y `turnos.ID_Profesional` apunta ahí) | Indiferente para la API; conviene unificar en la BD |
| 5 | Catálogos vacíos | — | Especialidades, parentescos, obras sociales, etc. sin filas | Cargar datos iniciales (T1.4) |
| 6 | CUD obligatorio | — | `CUD_Vencimiento NOT NULL` | ⚠️ ¿Todos los pacientes tienen CUD? Si no, permitir `null` |
| 7 | Autor y fecha de la nota | — | `registros_de_sesiones` solo tiene `NotaClinica` | Agregar columnas (T1.7) |

---

## 12. Checklist para cerrar el contrato
- [ ] Backend revisa y confirma el formato general (§1).
- [ ] Definir los ⚠️ de permisos (§2).
- [ ] Decidir `Hora` vs `HoraInicio` + `HoraFin` (§7, §11-1).
- [ ] Decidir si el CUD puede ser nulo (§11-6).
- [ ] Confirmar la duración de la sesión con "recordar" (§3).
- [ ] Confirmar las reglas agregadas en v0.2 y v0.3 (§13).
- [ ] Pasar este documento a v1.0 y congelarlo; los cambios siguientes se anotan en el historial (§13).

---

## 13. Historial de cambios

### v0.3 — 27/09/2026
Surgieron al implementar el módulo Profesionales del frontend:
- §2: definición precisa de **asignación vigente**: `fecha_fin` nula o **igual o posterior a hoy**
  (antes decía "nula o futura", que excluía el último día). Es lo que ya hacía la API simulada.
- §8 Asignaciones: `fecha_fin` ≥ `fecha_inicio`; quién puede leer (Admin todas, Profesional solo
  las suyas) y escribir (`profesionales.edit`); "Finalizar" manda `fecha_fin` = hoy.

### v0.2 — 26/09/2026
Reglas que surgieron al implementar la API simulada del frontend (`Frontend/static/mocks/servidor.js`),
que sirve como implementación de referencia:
- §1.5: tabla de códigos de conflicto; nuevos `tutor_ya_vinculado`, `sesion_existente` y `obra_social_duplicada`.
- §2: permisos que usa la API simulada mientras no se definan los ⚠️.
- §3: bloqueo del login (5 intentos fallidos → 60 s) y reglas de contraseña (mínimo 8 caracteres).
- §6: reglas del vínculo paciente↔tutor.
- §7: un turno nuevo solo puede crearse Pendiente o Confirmado; no se puede marcar como Realizado
  un turno futuro; no se reprograma un turno Cancelado/Realizado; solo el Admin cambia el profesional;
  la nota clínica solo la carga el profesional del turno, en turnos Confirmados/Realizados no futuros.
- §8: obra social duplicada y obra social dada de baja.
- §9: el administrador no puede cambiar su propio rol.

### v0.1 — 26/09/2026
Versión inicial.
