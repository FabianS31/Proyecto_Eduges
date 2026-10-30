
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

        extra_kwargs = {
            'mail': {
                'required': True,
                'allow_null': False,
                'allow_blank': False,
            },
            'domicilio': {
                'required': True,
                'allow_null': False,
                'allow_blank': False,
            },
        }
