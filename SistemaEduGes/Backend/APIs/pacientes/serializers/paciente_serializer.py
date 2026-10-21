from django.db import transaction
from django.utils import timezone

from rest_framework import serializers

from pacientes.models.paciente_model import (
    Paciente,
    EstadoPaciente
)
from pacientes.models.obra_social_model import (
    ObraSocial
)
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import (
    AsignacionProfesional
)


class EstadoPacienteSerializer(serializers.ModelSerializer):

    id = serializers.IntegerField(
        source='id_estado_paciente',
        read_only=True
    )

    nombre = serializers.CharField(
        source='estado',
        read_only=True
    )

    class Meta:
        model = EstadoPaciente
        fields = [
            'id',
            'nombre',
        ]


class EstadoObraSocialSerializer(serializers.ModelSerializer):

    id = serializers.IntegerField(
        source='id_estado_obra_social',
        read_only=True
    )

    class Meta:
        model = ObraSocial._meta.get_field('estado').remote_field.model
        fields = [
            'id',
            'descripcion',
        ]


class TipoObraSocialSerializer(serializers.ModelSerializer):

    id = serializers.IntegerField(
        source='id_tipo_os',
        read_only=True
    )

    class Meta:
        model = ObraSocial._meta.get_field('tipo').remote_field.model
        fields = [
            'id',
            'tipo',
        ]


class ObraSocialSerializer(serializers.ModelSerializer):

    id = serializers.IntegerField(
        source='id_obra_social',
        read_only=True
    )

    estado = EstadoObraSocialSerializer(
        read_only=True
    )

    tipo = TipoObraSocialSerializer(
        read_only=True
    )

    class Meta:
        model = ObraSocial
        fields = [
            'id',
            'nombre',
            'contacto',
            'mail',
            'web',
            'estado',
            'tipo',
        ]


class ObraSocialRelatedField(serializers.PrimaryKeyRelatedField):

    def use_pk_only_optimization(self):
        return False

    def to_representation(self, value):
        return ObraSocialSerializer(value).data


class ProfesionalResponsableSerializer(serializers.ModelSerializer):

    id = serializers.IntegerField(
        source='id_profesional',
        read_only=True
    )

    class Meta:
        model = Profesional
        fields = [
            'id',
            'nombre',
            'apellido',
        ]


class PacienteSerializer(serializers.ModelSerializer):

    obra_social = ObraSocialRelatedField(
        queryset=ObraSocial.objects.all(),
        required=True
    )

    estado = serializers.PrimaryKeyRelatedField(
        queryset=EstadoPaciente.objects.all(),
        required=False
    )

    profesional = serializers.PrimaryKeyRelatedField(
        queryset=Profesional.objects.all(),
        write_only=True,
        required=False
    )

    profesional_responsable = serializers.SerializerMethodField()

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
            'profesional_responsable',
        ]

        read_only_fields = [
            'id_paciente',
            'profesional_responsable',
        ]

    def get_profesional_responsable(self, obj):

        asignacion = (
            AsignacionProfesional.objects
            .filter(
                paciente=obj,
                fecha_fin__isnull=True
            )
            .select_related('profesional')
            .first()
        )

        if asignacion is None:
            return None

        return ProfesionalResponsableSerializer(
            asignacion.profesional
        ).data

    @transaction.atomic
    def create(self, validated_data):

        request = self.context.get('request')

        if request is None or not request.user:
            raise serializers.ValidationError({
                'detail': (
                    'No se pudo determinar el usuario '
                    'que está creando el paciente.'
                )
            })

        usuario = request.user

        if not usuario.rol:
            raise serializers.ValidationError({
                'detail': (
                    'El usuario no tiene un rol asignado.'
                )
            })

        nombre_rol = usuario.rol.rol

        if nombre_rol not in [
            'Administrador',
            'Profesional',
            'SuperAdministrador'
        ]:
            raise serializers.ValidationError({
                'detail': (
                    'Este usuario no tiene permiso para '
                    'crear pacientes.'
                )
            })

        profesional_indicado = validated_data.pop(
            'profesional',
            None
        )

        if nombre_rol == 'Profesional':

            try:
                profesional_creador = Profesional.objects.get(
                    usuario=usuario
                )
            except Profesional.DoesNotExist:
                raise serializers.ValidationError({
                    'detail': (
                        'El usuario autenticado no está '
                        'vinculado a un profesional.'
                    )
                })

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

            profesional_asignado = profesional_creador

        else:

            if profesional_indicado is None:
                raise serializers.ValidationError({
                    'profesional': (
                        'Debe indicar el profesional '
                        'responsable del paciente.'
                    )
                })

            profesional_asignado = profesional_indicado

        if 'estado' not in validated_data:

            try:
                estado_activo = EstadoPaciente.objects.get(
                    estado='Activo'
                )
            except EstadoPaciente.DoesNotExist:
                raise serializers.ValidationError({
                    'estado': (
                        'No existe el estado de paciente '
                        '"Activo" en la base de datos.'
                    )
                })

            validated_data['estado'] = estado_activo

        paciente = Paciente.objects.create(
            **validated_data
        )

        AsignacionProfesional.objects.create(
            paciente=paciente,
            profesional=profesional_asignado,
            fecha_inicio=timezone.localdate()
        )

        return paciente

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