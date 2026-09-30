from rest_framework import serializers

from ..models.profesional_model import Profesional


class ProfesionalSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profesional
        fields = '__all__'