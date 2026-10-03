from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from usuarios.models.usuario_model import Usuario

from .serializers.autenticacion_serializer import LoginSerializer


class LoginView(APIView):

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

        if usuario.password != password:
            return Response(
                {
                    'non_field_errors': [
                        'Usuario o contraseña incorrectos.'
                    ]
                },
                status=status.HTTP_400_BAD_REQUEST
            )

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