// ============================================================
// EduGes - Fechas
// Fechas ISO "YYYY-MM-DD" sin zona horaria.
// Se trabaja siempre en hora local para que "hoy" sea el día del usuario,
// no el día en UTC (que en Argentina cambia a las 21 hs).
// ============================================================

function fechaISO(fecha) {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
}

export function hoyISO() {
    return fechaISO(new Date());
}

// "2026-09-26" → Date local a las 00:00 de ese día
export function aFecha(iso) {
    const [anio, mes, dia] = iso.split('-').map(Number);
    return new Date(anio, mes - 1, dia);
}

export function sumarDias(iso, dias) {
    const fecha = aFecha(iso);
    fecha.setDate(fecha.getDate() + dias);
    return fechaISO(fecha);
}

// Años cumplidos a hoy: "2017-03-10" → 9
export function edad(nacimiento) {
    const [anio, mes, dia] = nacimiento.split('-').map(Number);
    const hoy = new Date();
    const yaCumplio = hoy.getMonth() + 1 > mes || (hoy.getMonth() + 1 === mes && hoy.getDate() >= dia);
    return hoy.getFullYear() - anio - (yaCumplio ? 0 : 1);
}

// Días desde "desde" hasta "hasta" (negativo si "hasta" es anterior)
export function diasEntre(desde, hasta) {
    const [a1, m1, d1] = desde.split('-').map(Number);
    const [a2, m2, d2] = hasta.split('-').map(Number);
    return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}
