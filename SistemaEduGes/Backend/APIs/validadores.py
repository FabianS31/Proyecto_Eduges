import re

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from rest_framework import serializers


def validar_password_nueva(value):
    """Validar sin transformar el secreto; los límites pertenecen a cada flujo."""
    if not value.strip():
        raise serializers.ValidationError('La contraseña no puede contener solamente espacios.')
    if value != value.strip():
        raise serializers.ValidationError('La contraseña no puede comenzar ni terminar con espacios en blanco.')
    return value


def identificador_positivo(value):
    """Identificador int4 positivo; no acepta coerciones de bool o float."""
    if type(value) is int:
        numero = value
    elif isinstance(value, str) and value.isdecimal():
        numero = int(value)
    else:
        raise ValueError('Identificador invalido')
    if not 1 <= numero <= 2147483647:
        raise ValueError('Identificador fuera de rango')
    return numero


def validar_dni(value):
    if not re.fullmatch(r'[0-9]{7,8}', value):
        raise serializers.ValidationError('El DNI debe contener exactamente 7 u 8 dígitos, sin puntos ni espacios interiores.')
    return value


class ValidarNombreApellidoMixin:
    MAX_LONGITUD = 60

    @staticmethod
    def normalizar_nombre_apellido(value):
        return re.sub(r'\s+', ' ', str(value).strip())

    def _validar_nombre_personal(self, campo, value):
        # No revalidar datos históricos que no cambiaron.
        if self.instance is not None and value == getattr(self.instance, campo):
            return value

        valor_normalizado = self.normalizar_nombre_apellido(value)

        if len(valor_normalizado) > self.MAX_LONGITUD:
            raise serializers.ValidationError(
                f'El {campo} no puede superar los {self.MAX_LONGITUD} caracteres.'
            )

        if not any(caracter.isalpha() for caracter in valor_normalizado):
            raise serializers.ValidationError('Debe contener al menos una letra; no puede ser solo números o símbolos.')

        if any(
            not (
                caracter.isalpha()
                or caracter.isspace()
                or caracter in "-'’"
            )
            for caracter in valor_normalizado
        ):
            raise serializers.ValidationError(
                f'El {campo} solo puede contener letras, espacios, guiones y apóstrofes.'
            )

        return valor_normalizado

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
