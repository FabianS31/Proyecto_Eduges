
from rest_framework import generics
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import ValidationError

from profesionales.models.profesional_model import Profesional
from APIs.profesionales.serializers.profesionales_serializer import ProfesionalSerializer
from APIs.autenticacion.permisos import TienePermiso
from APIs.servicios.estado_entidad_service import EstadoEntidadService


class ProfesionalListCreateView(generics.ListCreateAPIView):
    queryset = Profesional.objects.all()
    serializer_class = ProfesionalSerializer
    permission_classes = [TienePermiso]

    def get_permissions(self):
        self.permiso_requerido = (
            'profesionales.ver'
            if self.request.method == 'GET'
            else 'profesionales.crear'
        )

        return super().get_permissions()


class ProfesionalDetailView(generics.RetrieveUpdateAPIView):
    queryset = Profesional.objects.all()
    serializer_class = ProfesionalSerializer
    permission_classes = [TienePermiso]

    def get_permissions(self):
        if self.request.method in ['PUT', 'PATCH']:
            self.permiso_requerido = 'profesionales.editar'
        else:
            self.permiso_requerido = 'profesionales.ver'

        return super().get_permissions()


class ProfesionalEstadoView(APIView):
    permission_classes = [TienePermiso]

    def get_permissions(self):
        self.permiso_requerido = 'profesionales.editar'
        return super().get_permissions()

    def patch(self, request, pk):
        nuevo_estado = request.data.get('estado')

        if nuevo_estado is None:
            raise ValidationError({
                'estado': 'Este campo es obligatorio.'
            })

        profesional = EstadoEntidadService.cambiar_estado_profesional(
            id_profesional=pk,
            nuevo_estado=nuevo_estado
        )

        return Response({
            'mensaje': 'Estado del profesional actualizado correctamente.',
            'id_profesional': profesional.id_profesional,
            'estado': profesional.estado_profesional.estado,
        }, status=status.HTTP_200_OK)