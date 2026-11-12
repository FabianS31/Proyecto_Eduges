from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from APIs.autenticacion.autenticacion import UsuarioSessionAuthentication
from APIs.autenticacion.permisos import EsAdministradorConPermiso
from APIs.autenticacion.serializers.administrador_serializer import AdministradorEntradaSerializer
from usuarios.models.rol_model import Rol
from usuarios.models.usuario_model import Usuario


class AdministradorCrearView(APIView):
    authentication_classes = [UsuarioSessionAuthentication]
    permission_classes = [IsAuthenticated, EsAdministradorConPermiso]
    permiso_requerido = 'usuarios.admin'

    def post(self, request):
        serializer = AdministradorEntradaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            rol = Rol.objects.get(rol='Administrador')
        except Rol.DoesNotExist:
            raise ValidationError({'detail': 'No está configurado el rol Administrador.'})

        datos = serializer.validated_data
        try:
            with transaction.atomic():
                usuario = Usuario.objects.create(
                    usuario=datos['usuario'],
                    password=make_password(datos['password']),
                    rol=rol,
                    activo=True,
                )
        except IntegrityError:
            if Usuario.objects.filter(usuario=datos['usuario']).exists():
                raise ValidationError({'usuario': 'El nombre de usuario ya existe.'})
            raise

        return Response({
            'id': usuario.pk,
            'usuario': usuario.usuario,
            'rol': {'id': rol.pk, 'nombre': rol.rol},
        }, status=status.HTTP_201_CREATED)
