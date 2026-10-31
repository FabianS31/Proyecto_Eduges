from rest_framework import serializers

from pacientes.models import Tutor


class TutorEntradaSerializer(serializers.ModelSerializer):
    dni = serializers.CharField(max_length=20)

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

    def validate_dni(self, value):
        consulta = Tutor.objects.filter(dni=value)
        if self.instance is not None:
            consulta = consulta.exclude(pk=self.instance.pk)
            if consulta.exists():
                raise serializers.ValidationError(
                    'Ya existe un/a tutor con este/a dni.'
                )
        return value
