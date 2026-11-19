from rest_framework.exceptions import PermissionDenied
from APIs.servicios.errores_catalogo import CatalogoNoDisponible


def es_usuario_tecnico(usuario):
    return getattr(getattr(usuario, 'rol', None), 'rol', None) == 'SuperAdministrador'


def validar_edicion_cuenta(usuario, profesional):
    """Proteger cuentas privilegiadas aunque sus dos roles sean inconsistentes."""
    rol_actor = getattr(getattr(usuario, 'rol', None), 'rol', None)
    if not rol_actor or not rol_actor.strip():
        raise PermissionDenied('No tiene un rol válido para modificar cuentas.')
    rol_profesional = getattr(getattr(profesional, 'rol', None), 'rol', None)
    rol_cuenta = getattr(getattr(getattr(profesional, 'usuario', None), 'rol', None), 'rol', None)
    if not es_usuario_tecnico(usuario) and (
        not rol_profesional or not rol_profesional.strip()
        or not rol_cuenta or not rol_cuenta.strip()
    ):
        # Sin rol no se puede evaluar la protección de cuentas privilegiadas.
        # No conceder permisos por interpretar NULL como un rol ordinario.
        raise CatalogoNoDisponible(
            'El profesional no tiene rol configurado. Contacte a administración.'
        )
    if not es_usuario_tecnico(usuario) and (
        rol_profesional == 'SuperAdministrador'
        or es_usuario_tecnico(profesional.usuario)
    ):
        raise PermissionDenied('No puede modificar una cuenta técnica.')

    if getattr(getattr(usuario, 'rol', None), 'rol', None) == 'Profesional' and (
        rol_profesional == 'Administrador'
        or rol_cuenta == 'Administrador'
    ):
        raise PermissionDenied('Un Profesional no puede modificar una cuenta Administrador.')
