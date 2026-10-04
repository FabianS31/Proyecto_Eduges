from django.contrib.auth.hashers import (
    check_password,
    make_password
)
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from usuarios.models.rol_model import RolPermiso
from profesionales.models.profesional_model import Profesional
from usuarios.models.usuario_model import Usuario

from .serializers.autenticacion_serializer import (
    LoginSerializer,
    CambiarPasswordSerializer
)
from .intentos_limites import (
    esta_bloqueado,
    registrar_intento_fallido,
    reiniciar_intentos
)


@method_decorator(csrf_protect, name='dispatch')
class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)

        if not serializer.is_valid():
            return Response(
                serializer.errors,
                status=status.HTTP_400_BAD_REQUEST
            )

        usuario_nombre = serializer.validated_data['usuario']
        password = serializer.validated_data['password']
        recordar = serializer.validated_data['recordar']

        # Verificamos si el usuario ya alcanzó el límite
        # de intentos fallidos.
        if esta_bloqueado(usuario_nombre):
            return Response(
                {
                    'detail': (
                        'Demasiados intentos fallidos. '
                        'Intente nuevamente más tarde.'
                    ),
                    'reintentar_en': 60
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )

        try:
            usuario = Usuario.objects.select_related('rol').get(
                usuario=usuario_nombre
            )
        except Usuario.DoesNotExist:
            registrar_intento_fallido(usuario_nombre)

            return Response(
                {
                    'non_field_errors': [
                        'Usuario o contraseña incorrectos.'
                    ]
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        if not usuario.activo:
            registrar_intento_fallido(usuario_nombre)

            return Response(
                {
                    'non_field_errors': [
                        'Usuario o contraseña incorrectos.'
                    ]
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        if not check_password(password, usuario.password):
            registrar_intento_fallido(usuario_nombre)

            return Response(
                {
                    'non_field_errors': [
                        'Usuario o contraseña incorrectos.'
                    ]
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        # Login correcto: eliminamos los intentos fallidos anteriores.
        reiniciar_intentos(usuario_nombre)

        request.session.cycle_key()
        request.session['usuario_id'] = usuario.id_usuario

        if recordar:
            request.session.set_expiry(14 * 24 * 60 * 60)
        else:
            request.session.set_expiry(0)

        return Response(
            {
                'id': usuario.id_usuario,
                'usuario': usuario.usuario,
                'rol': {
                    'id': usuario.rol.id_rol,
                    'nombre': usuario.rol.rol
                } if usuario.rol else None
            },
            status=status.HTTP_200_OK
        )


@method_decorator(csrf_protect, name='dispatch')
class LogoutView(APIView):

    def post(self, request):
        request.session.flush()

        return Response(
            status=status.HTTP_204_NO_CONTENT
        )


class MeView(APIView):

    def get(self, request):

        if not request.user:
            return Response(
                {
                    'detail': 'No autenticado.'
                },
                status=status.HTTP_401_UNAUTHORIZED
            )

        profesional = None

        try:
            profesional = Profesional.objects.select_related(
                'especialidad'
            ).get(
                usuario=request.user
            )
        except Profesional.DoesNotExist:
            pass

        permisos = []

        if request.user.rol:
            permisos = list(
                RolPermiso.objects
                .filter(rol=request.user.rol)
                .select_related('permiso')
                .values_list('permiso__permiso', flat=True)
            )

        return Response(
            {
                'id': request.user.id_usuario,
                'usuario': request.user.usuario,

                'rol': {
                    'id': request.user.rol.id_rol,
                    'nombre': request.user.rol.rol
                } if request.user.rol else None,

                'profesional': {
                    'id': profesional.id_profesional,
                    'nombre': profesional.nombre,
                    'apellido': profesional.apellido,
                    'especialidad': {
                        'id': profesional.especialidad.id_especialidad,
                        'nombre': profesional.especialidad.especialidad
                    } if profesional.especialidad else None
                } if profesional else None,

                'permisos': permisos
            },
            status=status.HTTP_200_OK
        )


class CsrfView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        get_token(request)

        return Response(
            status=status.HTTP_204_NO_CONTENT
        )


@method_decorator(csrf_protect, name='dispatch')
class CambiarPasswordView(APIView):

    def post(self, request):

        serializer = CambiarPasswordSerializer(
            data=request.data,
            context={'request': request}
        )

        if not serializer.is_valid():
            return Response(
                serializer.errors,
                status=status.HTTP_400_BAD_REQUEST
            )

        nueva_password = serializer.validated_data[
            'password_nueva'
        ]

        request.user.password = make_password(
            nueva_password
        )

        request.user.save(
            update_fields=['password']
        )

        return Response(
            {
                'detail': 'Contraseña cambiada correctamente.'
            },
            status=status.HTTP_200_OK
        )