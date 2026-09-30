from rest_framework import generics

from .models.profesional_model import Profesional
from .serializers.profesionales_serializers import ProfesionalSerializer


class ProfesionalListView(generics.ListAPIView):
    queryset = Profesional.objects.all()
    serializer_class = ProfesionalSerializer
    