from rest_framework import generics

from profesionales.models.profesional_model import Profesional
from APIs.profesionales.serializers.profesionales_serializer import ProfesionalSerializer
from APIs.autenticacion.permisos import TienePermiso


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


class ProfesionalDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Profesional.objects.all()
    serializer_class = ProfesionalSerializer
    permission_classes = [TienePermiso]

    def get_permissions(self):
        if self.request.method in ['PUT', 'PATCH']:
            self.permiso_requerido = 'profesionales.editar'

        elif self.request.method == 'DELETE':
            self.permiso_requerido = 'profesionales.eliminar'

        else:
            self.permiso_requerido = 'profesionales.ver'

        return super().get_permissions()