// ============================================================
// EduGes - Texto
// Comparar y buscar sin que importen las mayúsculas ni los acentos.
// ============================================================

// "Gómez" → "gomez"
export function normalizarTexto(texto) {
    return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Cada palabra buscada tiene que aparecer en alguno de los campos:
// "maria gom" coincide con ['María', 'Gómez', '30123456']
export function coincideBusqueda(campos, busqueda) {
    const texto = normalizarTexto(campos.join(' '));
    return normalizarTexto(busqueda).split(/\s+/).every((palabra) => texto.includes(palabra));
}

// Para ordenar: sin acentos, en castellano y con los números en orden natural ("MP-9" antes que "MP-10")
export function compararTexto(a, b) {
    return normalizarTexto(a).localeCompare(normalizarTexto(b), 'es', { numeric: true });
}
