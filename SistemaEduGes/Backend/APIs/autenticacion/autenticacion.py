from rest_framework.authentication import BaseAuthentication


class UsuarioSessionAuthentication(BaseAuthentication):

    def authenticate(self, request):
        return None