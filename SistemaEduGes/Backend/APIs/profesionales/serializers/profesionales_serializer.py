
from django.contrib.auth.hashers import make_password
from django.db import transaction

from rest_framework import serializers

from profesionales.models.profesional_model import (
    Profesional,
    Especialidad,
)
from profesionales.models.estados_profesionales_model import (
    EstadoProfesional,
)
from usuarios.models.usuario_model import Usuario


Rol = Usuario._meta.get_field('rol').remote_field.model


# ---------------------------------------------------------
# SERIALIZERS DE CLAVES FORÁNEAS
# ---------------------------------------------------------

class EspecialidadSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(
        source='id_especialidad',
        read_only=True,
    )
    nombre = serializers.CharField(
        source='especialidad',
        read_only=True,
    )

    class Meta:
        model = Especialidad
        fields = ['id', 'nombre']


class RolSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(
        source='id_rol',
        read_only=True,
    )
    nombre = serializers.CharField(
        source='rol',
        read_only=True,
    )

    class Meta:
        model = Rol
        fields = ['id', 'nombre']


class EstadoProfesionalSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(
        source='id_estado_profesional',
        read_only=True,
    )
    nombre = serializers.CharField(
        source='estado',
        read_only=True,
    )

    class Meta:
        model = EstadoProfesional
        fields = ['id', 'nombre']


# ---------------------------------------------------------
# CAMPO QUE RECIBE UN ID Y DEVUELVE UN OBJETO DESCRIPTIVO
# ---------------------------------------------------------

class RelatedObjectField(serializers.PrimaryKeyRelatedField):

    def __init__(self, *args, serializer_class=None, **kwargs):
        self.serializer_class = serializer_class
        super().__init__(*args, **kwargs)

    def use_pk_only_optimization(self):
        # Necesitamos el objeto relacionado completo,
        # no solamente una referencia a su clave primaria.
        return False

    def to_representation(self, value):
        return self.serializer_class(value).data


# ---------------------------------------------------------
# SERIALIZER DE PROFESIONAL
# ---------------------------------------------------------

class ProfesionalSerializer(serializers.ModelSerializer):

    especialidad = RelatedObjectField(
        queryset=Especialidad.objects.all(),
        serializer_class=EspecialidadSerializer,
    )

    rol = RelatedObjectField(
        queryset=Rol.objects.all(),
        serializer_class=RolSerializer,
    )

    estado_profesional = RelatedObjectField(
        queryset=EstadoProfesional.objects.all(),
        serializer_class=EstadoProfesionalSerializer,
    )

    usuario = serializers.CharField(
        write_only=True,
        required=False,
    )

    password = serializers.CharField(
        write_only=True,
        required=False,
        min_length=8,
    )

    class Meta:
        model = Profesional
        fields = [
            'id_profesional',
            'nombre',
            'apellido',
            'dni',
            'matricula',
            'contacto',
            'mail',
            'especialidad',
            'rol',
            'usuario',
            'password',
            'estado_profesional',
        ]
        read_only_fields = ['id_profesional']

    # -----------------------------------------------------
    # CREAR PROFESIONAL Y USUARIO
    # -----------------------------------------------------

    @transaction.atomic
    def create(self, validated_data):
        nombre_usuario = validated_data.pop('usuario')
        password = validated_data.pop('password')

        if Usuario.objects.filter(
            usuario=nombre_usuario
        ).exists():
            raise serializers.ValidationError({
                'usuario': 'El nombre de usuario ya existe.'
            })

        usuario = Usuario.objects.create(
            usuario=nombre_usuario,
            password=make_password(password),
            rol=validated_data['rol'],
            activo=True,
        )

        profesional = Profesional.objects.create(
            usuario=usuario,
            **validated_data,
        )

        return profesional

    # -----------------------------------------------------
    # MODIFICAR PROFESIONAL Y USUARIO
    # -----------------------------------------------------

    @transaction.atomic
    def update(self, instance, validated_data):
        nombre_usuario = validated_data.pop('usuario', None)
        password = validated_data.pop('password', None)

        usuario = instance.usuario

        if nombre_usuario is not None:
            usuario_existente = Usuario.objects.filter(
                usuario=nombre_usuario
            ).exclude(
                pk=usuario.pk
            ).exists()

            if usuario_existente:
                raise serializers.ValidationError({
                    'usuario': 'El nombre de usuario ya existe.'
                })

            usuario.usuario = nombre_usuario

        if password is not None:
            usuario.password = make_password(password)

        if 'rol' in validated_data:
            usuario.rol = validated_data['rol']

        campos_usuario = []

        if nombre_usuario is not None:
            campos_usuario.append('usuario')

        if password is not None:
            campos_usuario.append('password')

        if 'rol' in validated_data:
            campos_usuario.append('rol')

        if campos_usuario:
            usuario.save(update_fields=campos_usuario)

        for atributo, valor in validated_data.items():
            setattr(instance, atributo, valor)

        instance.save()

        return instance

    # -----------------------------------------------------
    # VALIDAR DNI
    # -----------------------------------------------------

    def validate_dni(self, value):
        consulta = Profesional.objects.filter(dni=value)

        if self.instance is not None:
            consulta = consulta.exclude(pk=self.instance.pk)

        if consulta.exists():
            raise serializers.ValidationError(
                'Ya existe un profesional con ese DNI.'
            )

        return value

    # -----------------------------------------------------
    # VALIDAR MATRÍCULA
    # -----------------------------------------------------

    def validate_matricula(self, value):
        consulta = Profesional.objects.filter(
            matricula=value
        )

        if self.instance is not None:
            consulta = consulta.exclude(pk=self.instance.pk)

        if consulta.exists():
            raise serializers.ValidationError(
                'Ya existe un profesional con esa matrícula.'
            )

        return value