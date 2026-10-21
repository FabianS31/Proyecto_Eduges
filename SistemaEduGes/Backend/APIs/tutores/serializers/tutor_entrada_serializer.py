
from rest_framework import serializers

from pacientes.models import Tutor


class TutorEntradaSerializer(serializers.ModelSerializer):

    class Meta:
        model = Tutor
        fields = [
            'nombre',
            'apellido',
            'dni',
            'telefono',
            'movil',
            'mail',
            'domicilio',
        ]
