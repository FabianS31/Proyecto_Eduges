from rest_framework import serializers

from usuarios.models.usuario_model import Usuario


class AdministradorEntradaSerializer(serializers.Serializer):
    usuario = serializers.CharField(max_length=100)
    password = serializers.CharField(
        min_length=8, max_length=128, trim_whitespace=False, write_only=True,
    )

    def validate(self, attrs):
        desconocidos = set(self.initial_data) - set(self.fields)
        if desconocidos:
            raise serializers.ValidationError({
                campo: 'Este campo no se puede indicar en el alta.'
                for campo in desconocidos
            })
        return attrs

    def validate_usuario(self, value):
        if any(caracter.isspace() for caracter in value):
            raise serializers.ValidationError('El usuario no puede contener espacios.')
        if Usuario.objects.filter(usuario=value).exists():
            raise serializers.ValidationError('El nombre de usuario ya existe.')
        return value

    def validate_password(self, value):
        if not value.strip():
            raise serializers.ValidationError('La contraseña no puede contener solamente espacios.')
        if value != value.strip():
            raise serializers.ValidationError('La contraseña no puede comenzar ni terminar con espacios.')
        return value
