from rest_framework import serializers

from profesionales.models.profesional_model import Especialidad


class EspecialidadEntradaSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=100)

    def validate_nombre(self, value):
        if Especialidad.objects.filter(especialidad=value).exists():
            raise serializers.ValidationError('Ya existe una especialidad con ese nombre.')
        return value
