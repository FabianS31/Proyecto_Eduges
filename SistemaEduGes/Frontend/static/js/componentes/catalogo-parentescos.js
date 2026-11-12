import { catalogos } from '../endpoints.js';

// Carga compartida por alta de paciente y vinculación de tutor.
export async function cargarParentescos(select, aviso, reintentar) {
    if (!select || select.dataset.cargado === 'true' || select.dataset.cargando === 'true') return;
    reintentar.onclick = () => cargarParentescos(select, aviso, reintentar);
    reintentar.hidden = true;
    select.disabled = true;
    select.dataset.cargando = 'true';
    aviso.textContent = 'Cargando parentescos…';
    try {
        const lista = await catalogos.parentescos();
        if (!Array.isArray(lista) || lista.some(item => !Number.isSafeInteger(item?.id)
            || item.id <= 0 || typeof item.nombre !== 'string')) {
            throw new Error('Catálogo de parentescos inválido');
        }
        // Leer ahora: cerrar el formulario mientras carga puede haberlo restablecido.
        const seleccionado = select.value;
        select.innerHTML = '<option value="">Seleccioná un parentesco</option>';
        for (const item of lista) {
            const opcion = document.createElement('option');
            opcion.value = item.id;
            opcion.textContent = item.nombre;
            select.appendChild(opcion);
        }
        select.value = lista.some(item => String(item.id) === seleccionado) ? seleccionado : '';
        if (!lista.length) {
            aviso.textContent = 'No hay parentescos disponibles. Consultá a Administración y reintentá.';
            return;
        }
        select.dataset.cargado = 'true';
        select.disabled = false;
        aviso.textContent = '';
    } catch {
        select.innerHTML = '<option value="">Seleccioná un parentesco</option>';
        aviso.textContent = 'No se pudieron cargar los parentescos. Reintentá para continuar.';
    } finally {
        select.dataset.cargando = 'false';
        reintentar.hidden = select.dataset.cargado === 'true';
    }
}
