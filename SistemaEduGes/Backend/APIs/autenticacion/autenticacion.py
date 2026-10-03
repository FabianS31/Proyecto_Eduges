from rest_framework.authentication import BaseAuthentication

from usuarios.models.usuario_model import Usuario


class UsuarioSessionAuthentication(BaseAuthentication):

    def authenticate(self, request):

        usuario_id = request.session.get('usuario_id')

        if not usuario_id:
            return None

        try:
            usuario = Usuario.objects.select_related('rol').get(
                id_usuario=usuario_id
            )
        except Usuario.DoesNotExist:
            return None

        if not usuario.activo:
            return None

        return (usuario, None)

    def authenticate_header(self, request):
        return 'Session'