from rest_framework.permissions import BasePermission


class TienePermiso(BasePermission):
    """
    Permite acceder al endpoint si el usuario autenticado
    posee el permiso indicado en la vista.

    El SuperAdministrador tiene acceso total.
    """

    def has_permission(self, request, view):

        if not request.user:
            return False

        # El SuperAdministrador tiene acceso total.
        if (
            request.user.rol
            and request.user.rol.rol == 'SuperAdministrador'
        ):
            return True

        permiso_requerido = getattr(
            view,
            'permiso_requerido',
            None
        )

        if not permiso_requerido:
            return False

        from usuarios.models.rol_model import RolPermiso

        return RolPermiso.objects.filter(
            rol=request.user.rol,
            permiso__permiso=permiso_requerido
        ).exists()


class EsAdministradorConPermiso(TienePermiso):
    """Altas institucionales: administrador con permiso o cuenta técnica."""

    def has_permission(self, request, view):
        rol = getattr(getattr(request.user, 'rol', None), 'rol', None)
        return (
            rol in ('Administrador', 'SuperAdministrador')
            and super().has_permission(request, view)
        )
