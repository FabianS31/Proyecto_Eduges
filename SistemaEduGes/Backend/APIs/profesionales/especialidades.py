from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from APIs.autenticacion.autenticacion import UsuarioSessionAuthentication
from APIs.autenticacion.permisos import EsAdministradorConPermiso
from APIs.profesionales.serializers.especialidad_serializer import EspecialidadEntradaSerializer
from APIs.profesionales.serializers.profesionales_serializer import EspecialidadSerializer
from profesionales.models.profesional_model import Especialidad


class EspecialidadListCreateView(APIView):
    authentication_classes = [UsuarioSessionAuthentication]
    permiso_requerido = 'usuarios.admin'

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAuthenticated()]
        return [IsAuthenticated(), EsAdministradorConPermiso()]

    def get(self, request):
        especialidades = Especialidad.objects.order_by('especialidad')
        return Response(EspecialidadSerializer(especialidades, many=True).data)

    def post(self, request):
        serializer = EspecialidadEntradaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        nombre = serializer.validated_data['nombre']
        try:
            with transaction.atomic():
                especialidad = Especialidad.objects.create(especialidad=nombre)
        except IntegrityError:
            if Especialidad.objects.filter(especialidad=nombre).exists():
                raise ValidationError({'nombre': 'Ya existe una especialidad con ese nombre.'})
            raise
        return Response(
            EspecialidadSerializer(especialidad).data,
            status=status.HTTP_201_CREATED,
        )
