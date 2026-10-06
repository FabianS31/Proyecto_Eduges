from django.contrib.auth.hashers import make_password
from django.db import transaction

from rest_framework import serializers

from profesionales.models.profesional_model import Profesional
from usuarios.models.usuario_model import Usuario


class ProfesionalSerializer(serializers.ModelSerializer):

    # ---------------------------------------------------------
    # DATOS DEL USUARIO
    # ---------------------------------------------------------
    # El administrador puede indicar el nombre de usuario.
    #
    # write_only=True:
    # estos datos pueden entrar a la API, pero nunca salen
    # en la respuesta.
    # ---------------------------------------------------------

    usuario = serializers.CharField(
        write_only=True,
        required=False
    )

    password = serializers.CharField(
        write_only=True,
        required=False,
        min_length=8
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

        read_only_fields = [
            'id_profesional',
        ]

    # ---------------------------------------------------------
    # CREAR PROFESIONAL + USUARIO
    # ---------------------------------------------------------

    @transaction.atomic
    def create(self, validated_data):

        nombre_usuario = validated_data.pop('usuario')
        password = validated_data.pop('password')

        # -----------------------------------------------------
        # VALIDAR NOMBRE DE USUARIO
        # -----------------------------------------------------

        if Usuario.objects.filter(
            usuario=nombre_usuario
        ).exists():

            raise serializers.ValidationError({
                'usuario': 'El nombre de usuario ya existe.'
            })

        # -----------------------------------------------------
        # CREAR USUARIO
        # -----------------------------------------------------

        usuario = Usuario.objects.create(
            usuario=nombre_usuario,
            password=make_password(password),
            rol=validated_data['rol'],
            activo=True
        )

        # -----------------------------------------------------
        # CREAR PROFESIONAL
        # -----------------------------------------------------

        profesional = Profesional.objects.create(
            usuario=usuario,
            **validated_data
        )

        return profesional

    # ---------------------------------------------------------
    # MODIFICAR PROFESIONAL + USUARIO
    # ---------------------------------------------------------

    @transaction.atomic
    def update(self, instance, validated_data):

        # -----------------------------------------------------
        # DATOS DEL USUARIO
        # -----------------------------------------------------

        nombre_usuario = validated_data.pop(
            'usuario',
            None
        )

        password = validated_data.pop(
            'password',
            None
        )

        usuario = instance.usuario

        # -----------------------------------------------------
        # CAMBIAR NOMBRE DE USUARIO
        # -----------------------------------------------------

        if nombre_usuario is not None:

            usuario_existente = Usuario.objects.filter(
                usuario=nombre_usuario
            ).exclude(
                pk=usuario.pk
            ).exists()

            if usuario_existente:

                raise serializers.ValidationError({
                    'usuario': (
                        'El nombre de usuario ya existe.'
                    )
                })

            usuario.usuario = nombre_usuario

        # -----------------------------------------------------
        # CAMBIAR CONTRASEÑA
        # -----------------------------------------------------
        # Si no se proporciona una contraseña nueva,
        # conservamos la actual.
        # -----------------------------------------------------

        if password is not None:

            usuario.password = make_password(
                password
            )

        # -----------------------------------------------------
        # SI CAMBIA EL ROL DEL PROFESIONAL
        # -----------------------------------------------------
        # El usuario y el profesional deben conservar
        # el mismo rol.
        # -----------------------------------------------------

        if 'rol' in validated_data:

            usuario.rol = validated_data['rol']

        # Guardamos los cambios del usuario.

        campos_usuario = []

        if nombre_usuario is not None:
            campos_usuario.append('usuario')

        if password is not None:
            campos_usuario.append('password')

        if 'rol' in validated_data:
            campos_usuario.append('rol')

        if campos_usuario:
            usuario.save(
                update_fields=campos_usuario
            )

        # -----------------------------------------------------
        # ACTUALIZAR PROFESIONAL
        # -----------------------------------------------------

        for atributo, valor in validated_data.items():

            setattr(
                instance,
                atributo,
                valor
            )

        instance.save()

        return instance

    # ---------------------------------------------------------
    # VALIDAR DNI
    # ---------------------------------------------------------

    def validate_dni(self, value):

        consulta = Profesional.objects.filter(
            dni=value
        )

        if self.instance is not None:

            consulta = consulta.exclude(
                pk=self.instance.pk
            )

        if consulta.exists():

            raise serializers.ValidationError(
                'Ya existe un profesional con ese DNI.'
            )

        return value

    # ---------------------------------------------------------
    # VALIDAR MATRÍCULA
    # ---------------------------------------------------------

    def validate_matricula(self, value):

        consulta = Profesional.objects.filter(
            matricula=value
        )

        if self.instance is not None:

            consulta = consulta.exclude(
                pk=self.instance.pk
            )

        if consulta.exists():

            raise serializers.ValidationError(
                'Ya existe un profesional con esa matrícula.'
            )

        return value