from django.contrib.auth.hashers import check_password
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from profesionales.models.profesional_model import Profesional
from usuarios.models.usuario_model import Usuario

from .serializers.autenticacion_serializer import LoginSerializer


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

        try:
            usuario = Usuario.objects.select_related('rol').get(
                usuario=usuario_nombre
            )
        except Usuario.DoesNotExist:
            return Response(
                {
                    'non_field_errors': [
                        'Usuario o contraseña incorrectos.'
                    ]
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        if not usuario.activo:
            return Response(
                {
                    'non_field_errors': [
                        'Usuario o contraseña incorrectos.'
                    ]
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        if not check_password(password, usuario.password):
            return Response(
                {
                    'non_field_errors': [
                        'Usuario o contraseña incorrectos.'
                    ]
                },
                status=status.HTTP_400_BAD_REQUEST
            )

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

                'permisos': []
            },
            status=status.HTTP_200_OK
        )
