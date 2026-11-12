import re

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from rest_framework import serializers


def validar_dni(value):
    if not re.fullmatch(r'[0-9]{7,8}', value):
        raise serializers.ValidationError('El DNI debe contener exactamente 7 u 8 dígitos, sin puntos ni espacios interiores.')
    return value


class ValidarNombreApellidoMixin:
    def _validar_nombre_personal(self, campo, value):
        # No revalidar datos históricos que no cambiaron.
        if self.instance is not None and value == getattr(self.instance, campo):
            return value
        if not any(caracter.isalpha() for caracter in value):
            raise serializers.ValidationError('Debe contener al menos una letra; no puede ser solo números o símbolos.')
        return value

    def validate_nombre(self, value):
        return self._validar_nombre_personal('nombre', value)

    def validate_apellido(self, value):
        return self._validar_nombre_personal('apellido', value)


class ValidarDomicilioMixin:
    def _validar_domicilio(self, campo, value):
        if self.instance is not None and value == getattr(self.instance, campo):
            return value
        try:
            validate_email(value)
        except ValidationError:
            return value
        raise serializers.ValidationError('Ingresá un domicilio válido, no una dirección de correo electrónico')

    def validate_direccion(self, value):
        return self._validar_domicilio('direccion', value)

    def validate_domicilio(self, value):
        return self._validar_domicilio('domicilio', value)
