from rest_framework import generics, permissions

from profesionales.models.profesional_model import Profesional
from APIs.profesionales.serializers.profesionales_serializer import ProfesionalSerializer


class ProfesionalListView(generics.ListAPIView):
    queryset = Profesional.objects.all()
    serializer_class = ProfesionalSerializer
    permission_classes = [permissions.IsAuthenticated]