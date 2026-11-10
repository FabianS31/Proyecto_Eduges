from rest_framework.exceptions import PermissionDenied


def es_usuario_tecnico(usuario):
    return getattr(getattr(usuario, 'rol', None), 'rol', None) == 'SuperAdministrador'


def validar_edicion_cuenta(usuario, profesional):
    """Proteger cuentas privilegiadas aunque sus dos roles sean inconsistentes."""
    if not es_usuario_tecnico(usuario) and (
        profesional.rol.rol == 'SuperAdministrador'
        or es_usuario_tecnico(profesional.usuario)
    ):
        raise PermissionDenied('No puede modificar una cuenta técnica.')

    if getattr(getattr(usuario, 'rol', None), 'rol', None) == 'Profesional' and (
        profesional.rol.rol == 'Administrador'
        or profesional.usuario.rol.rol == 'Administrador'
    ):
        raise PermissionDenied('Un Profesional no puede modificar una cuenta Administrador.')
