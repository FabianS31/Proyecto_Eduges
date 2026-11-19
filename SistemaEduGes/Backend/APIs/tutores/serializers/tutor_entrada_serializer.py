from rest_framework import serializers
from APIs.validadores import validar_dni, ValidarNombreApellidoMixin, ValidarDomicilioMixin

from pacientes.models import Tutor
from collections.abc import Mapping
from APIs.tutores.services import TutorService


class TutorEntradaSerializer(ValidarDomicilioMixin, ValidarNombreApellidoMixin, serializers.ModelSerializer):
    dni = serializers.CharField(max_length=20, trim_whitespace=False)
    mail = serializers.EmailField(max_length=150)

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
        if self.instance is None or value != self.instance.dni:
            validar_dni(value)
        consulta = Tutor.objects.filter(dni=value)
        if self.instance is not None:
            consulta = consulta.exclude(pk=self.instance.pk)
            if consulta.exists():
                raise serializers.ValidationError(
                    'Ya existe un/a tutor con este/a dni.'
                )
        return value


class TutorCreacionOReutilizacionSerializer(TutorEntradaSerializer):
    """Omitir datos personales solo para un tutor visible al usuario actual."""

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            return super().to_internal_value(data)
        try:
            dni = self.fields['dni'].run_validation(data.get('dni', serializers.empty))
            validar_dni(dni)
        except serializers.ValidationError as error:
            raise serializers.ValidationError({'dni': error.detail}) from error
        usuario = getattr(self.context.get('request'), 'user', None)
        tutor = TutorService.buscar_tutor_autorizado(dni, usuario)
        if tutor is None:
            return super().to_internal_value(data)
        # No validar ni enviar a persistencia datos históricos o reemplazos.
        for nombre in TutorEntradaSerializer.Meta.fields:
            if nombre != 'dni':
                self.fields[nombre].read_only = True
        attrs = super().to_internal_value(data)
        attrs['_tutor_existente_id'] = tutor.pk
        return attrs
