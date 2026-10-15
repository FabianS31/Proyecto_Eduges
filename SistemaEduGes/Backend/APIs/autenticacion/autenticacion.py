from datetime import timedelta

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication

from usuarios.models.usuario_model import Usuario


class UsuarioSessionAuthentication(BaseAuthentication):

    TIEMPO_INACTIVIDAD = timedelta(minutes=20)
    CLAVE_ULTIMA_ACTIVIDAD = '_last_activity'

    def authenticate(self, request):

        usuario_id = request.session.get('usuario_id')

        if not usuario_id:
            return None

        ultima_actividad = request.session.get(
            self.CLAVE_ULTIMA_ACTIVIDAD
        )

        ahora = timezone.now()

        if ultima_actividad:
            ultima_actividad = timezone.datetime.fromisoformat(
                ultima_actividad
            )

            if timezone.is_naive(ultima_actividad):
                ultima_actividad = timezone.make_aware(
                    ultima_actividad,
                    timezone.get_current_timezone()
                )

            if ahora - ultima_actividad >= self.TIEMPO_INACTIVIDAD:
                request.session.flush()
                return None

        try:
            usuario = Usuario.objects.select_related('rol').get(
                id_usuario=usuario_id
            )
        except Usuario.DoesNotExist:
            request.session.flush()
            return None

        if not usuario.activo:
            request.session.flush()
            return None

        request.session[self.CLAVE_ULTIMA_ACTIVIDAD] = (
            ahora.isoformat()
        )

        return (usuario, None)

    def authenticate_header(self, request):
        return 'Session'