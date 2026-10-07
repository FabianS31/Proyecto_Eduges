// ============================================================
// EduGes - Listados filtrados en el navegador
// Para las APIs que devuelven todo junto (pacientes, profesionales): la página
// guarda su estado en la URL y pagina en el navegador.
//
//   const parametros = leerUrl();                         // ?q=...&page=2
//   const resultado = paginar(lista, filtros.page, 10);   // { items, pagina, paginas, ... }
//   mostrarPaginacion(nav, resultado);
//   guardarEnUrl({ q: filtros.q, page: resultado.pagina > 1 ? resultado.pagina : null });
// ============================================================

// "5" → 5; cualquier otra cosa → null
export function enteroDeUrl(valor) {
    return /^\d+$/.test(valor ?? '') ? Number(valor) : null;
}

export function leerUrl() {
    return new URLSearchParams(window.location.search);
}

// Reescribe la URL sin recargar ni sumar al historial. null o '' sacan el parámetro.
export function guardarEnUrl(valores) {
    const url = new URL(window.location.href);
    for (const [clave, valor] of Object.entries(valores)) {
        if (valor === null || valor === undefined || valor === '') {
            url.searchParams.delete(clave);
        } else {
            url.searchParams.set(clave, valor);
        }
    }
    window.history.replaceState(null, '', url);
}

// Una página de la lista. Si la página pedida no existe (URL vieja, o la búsqueda
// achicó el resultado) se usa la última que sí existe.
export function paginar(lista, pagina, tamanio) {
    const paginas = Math.max(1, Math.ceil(lista.length / tamanio));
    const actual = Math.min(Math.max(1, pagina), paginas);
    const inicio = (actual - 1) * tamanio;
    const items = lista.slice(inicio, inicio + tamanio);
    return {
        items,
        pagina: actual,
        paginas,
        total: lista.length,
        desde: inicio + 1,
        hasta: inicio + items.length,
    };
}

// La barra de paginación (<nav> con #paginacion-texto y los botones anterior/siguiente)
// se muestra solo si hay más de una página
export function mostrarPaginacion(nav, { pagina, paginas, total, desde, hasta }) {
    nav.classList.toggle('d-none', paginas <= 1);
    if (paginas <= 1) {
        return;
    }
    nav.querySelector('#paginacion-texto').textContent = `Mostrando ${desde}–${hasta} de ${total}`;
    nav.querySelector('#btn-pagina-anterior').disabled = pagina <= 1;
    nav.querySelector('#btn-pagina-siguiente').disabled = pagina >= paginas;
}

// alCambiar recibe -1 (anterior) o +1 (siguiente)
export function prepararPaginacion(nav, alCambiar) {
    nav.querySelector('#btn-pagina-anterior').addEventListener('click', () => alCambiar(-1));
    nav.querySelector('#btn-pagina-siguiente').addEventListener('click', () => alCambiar(1));
}

// "1 paciente", "6 pacientes" o, si hay filtro, "2 de 6"
export function textoTotal(mostrados, total, [singular, plural]) {
    if (mostrados !== total) {
        return `${mostrados} de ${total}`;
    }
    return total === 1 ? `1 ${singular}` : `${total} ${plural}`;
}
