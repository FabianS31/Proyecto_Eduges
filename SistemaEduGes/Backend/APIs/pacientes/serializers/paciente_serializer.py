from django.db import transaction

from rest_framework import serializers

from pacientes.models.paciente_model import (
    Paciente,
    EstadoPaciente
)
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import (
    AsignacionProfesional
)


class PacienteSerializer(serializers.ModelSerializer):

    # ---------------------------------------------------------
    # PROFESIONAL RESPONSABLE
    # ---------------------------------------------------------
    # Este campo solamente se utiliza al CREAR un paciente.
    #
    # Si quien crea es un ADMIN:
    #     debe indicar el profesional.
    #
    # Si quien crea es un PROFESIONAL:
    #     el Backend ignora esta posibilidad y utiliza
    #     automáticamente al profesional autenticado.
    #
    # El campo es write_only porque la asignación se maneja
    # mediante la tabla ASIGNACIONES_PROFESIONALES.
    # ---------------------------------------------------------

    profesional = serializers.PrimaryKeyRelatedField(
        queryset=Profesional.objects.all(),
        write_only=True,
        required=False
    )

    class Meta:
        model = Paciente

        fields = [
            'id_paciente',
            'nombre',
            'apellido',
            'dni',
            'fecha_nacimiento',
            'direccion',
            'mail',
            'consentimiento',
            'cud_numero',
            'cud_vencimiento',
            'obra_social',
            'numero_afiliado',
            'estado',
            'profesional',
        ]

        read_only_fields = [
            'id_paciente',
        ]

    # ---------------------------------------------------------
    # CREAR PACIENTE
    # ---------------------------------------------------------

    @transaction.atomic
    def create(self, validated_data):

        # -----------------------------------------------------
        # OBTENER USUARIO AUTENTICADO
        # -----------------------------------------------------

        request = self.context.get('request')

        if request is None or not request.user:
            raise serializers.ValidationError({
                'detail': (
                    'No se pudo determinar el usuario '
                    'que está creando el paciente.'
                )
            })

        usuario = request.user

        # -----------------------------------------------------
        # OBTENER ROL
        # -----------------------------------------------------

        if not usuario.rol:

            raise serializers.ValidationError({
                'detail': (
                    'El usuario no tiene un rol asignado.'
                )
            })

        nombre_rol = usuario.rol.rol

        # -----------------------------------------------------
        # SOLAMENTE ADMINISTRADOR Y PROFESIONAL
        # PUEDEN CREAR PACIENTES
        # -----------------------------------------------------

        if nombre_rol not in [
            'Administrador',
            'Profesional'
        ]:

            raise serializers.ValidationError({
                'detail': (
                    'Este usuario no tiene permiso para '
                    'crear pacientes.'
                )
            })

        # -----------------------------------------------------
        # OBTENER PROFESIONAL ENVIADO
        # -----------------------------------------------------

        profesional_indicado = validated_data.pop(
            'profesional',
            None
        )

        # -----------------------------------------------------
        # SI CREA UN PROFESIONAL
        # -----------------------------------------------------

        if nombre_rol == 'Profesional':

            # Buscamos al profesional relacionado con
            # el usuario autenticado.

            try:

                profesional_creador = (
                    Profesional.objects.get(
                        usuario=usuario
                    )
                )

            except Profesional.DoesNotExist:

                raise serializers.ValidationError({
                    'detail': (
                        'El usuario autenticado no está '
                        'vinculado a un profesional.'
                    )
                })

            # Un profesional NO puede elegir a otro
            # profesional al crear un paciente.

            if (
                profesional_indicado is not None
                and profesional_indicado.pk
                != profesional_creador.pk
            ):

                raise serializers.ValidationError({
                    'profesional': (
                        'Un profesional solamente puede '
                        'asignarse pacientes a sí mismo.'
                    )
                })

            # La asignación siempre será al profesional
            # que está creando el paciente.

            profesional_asignado = profesional_creador

        # -----------------------------------------------------
        # SI CREA UN ADMINISTRADOR
        # -----------------------------------------------------

        else:

            # El administrador debe indicar a qué
            # profesional se asignará el paciente.

            if profesional_indicado is None:

                raise serializers.ValidationError({
                    'profesional': (
                        'Debe indicar el profesional '
                        'responsable del paciente.'
                    )
                })

            profesional_asignado = profesional_indicado

        # -----------------------------------------------------
        # ESTADO INICIAL DEL PACIENTE
        # -----------------------------------------------------
        # Si no se indica un estado, el paciente comienza
        # como Activo.
        # -----------------------------------------------------

        if 'estado' not in validated_data:

            try:

                estado_activo = (
                    EstadoPaciente.objects.get(
                        estado='Activo'
                    )
                )

            except EstadoPaciente.DoesNotExist:

                raise serializers.ValidationError({
                    'estado': (
                        'No existe el estado de paciente '
                        '"Activo" en la base de datos.'
                    )
                })

            validated_data['estado'] = estado_activo

        # -----------------------------------------------------
        # CREAR PACIENTE
        # -----------------------------------------------------

        paciente = Paciente.objects.create(
            **validated_data
        )

        # -----------------------------------------------------
        # CREAR ASIGNACIÓN INICIAL
        # -----------------------------------------------------

        from django.utils import timezone

        AsignacionProfesional.objects.create(
            paciente=paciente,
            profesional=profesional_asignado,
            fecha_inicio=timezone.localdate()
        )

        return paciente

    # ---------------------------------------------------------
    # VALIDAR DNI
    # ---------------------------------------------------------

    def validate_dni(self, value):

        consulta = Paciente.objects.filter(
            dni=value
        )

        if self.instance is not None:

            consulta = consulta.exclude(
                pk=self.instance.pk
            )

        if consulta.exists():

            raise serializers.ValidationError(
                'Ya existe un paciente con ese DNI.'
            )

        return value