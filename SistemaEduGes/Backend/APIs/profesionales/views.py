from rest_framework import generics
from profesionales.models.profesional_model import Profesional
from APIs.profesionales.serializers.profesionales_serializer import ProfesionalSerializer
from APIs.autenticacion.permisos import TienePermiso


class ProfesionalListView(generics.ListAPIView):
    queryset = Profesional.objects.all()
    serializer_class = ProfesionalSerializer
    permission_classes = [TienePermiso]

    permiso_requerido = 'profesionales.ver'