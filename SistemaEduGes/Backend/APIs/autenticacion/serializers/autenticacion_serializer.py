from django.contrib.auth.hashers import check_password
from rest_framework import serializers

from usuarios.models.usuario_model import Usuario


class LoginSerializer(serializers.Serializer):

    usuario = serializers.CharField()

    password = serializers.CharField()

    recordar = serializers.BooleanField(default=False)


class CambiarPasswordSerializer(serializers.Serializer):

    password_actual = serializers.CharField(
        write_only=True
    )

    password_nueva = serializers.CharField(
        write_only=True
    )

    def validate_password_actual(self, value):
        usuario = self.context['request'].user

        if not check_password(value, usuario.password):
            raise serializers.ValidationError(
                'La contraseña actual es incorrecta.'
            )

        return value

    def validate_password_nueva(self, value):

        if len(value) < 8:
            raise serializers.ValidationError(
                'La nueva contraseña debe tener al menos 8 caracteres.'
            )

        return value

    def validate(self, attrs):

        if attrs['password_actual'] == attrs['password_nueva']:
            raise serializers.ValidationError(
                {
                    'password_nueva': (
                        'La nueva contraseña debe ser '
                        'diferente de la actual.'
                    )
                }
            )

        return attrs