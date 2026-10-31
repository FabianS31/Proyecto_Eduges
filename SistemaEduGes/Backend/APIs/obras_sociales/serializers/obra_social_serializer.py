
from rest_framework import serializers

from pacientes.models.obra_social_model import (
    ObraSocial,
    EstadoObraSocial,
    TipoObraSocial,
)

from APIs.obras_sociales.services.obra_social_service import (
    ObraSocialService
)


class EstadoObraSocialSerializer(serializers.ModelSerializer):

    id = serializers.IntegerField(
        source='id_estado_obra_social',
        read_only=True
    )

    nombre = serializers.CharField(
        source='descripcion',
        read_only=True
    )

    class Meta:
        model = EstadoObraSocial
        fields = [
            'id',
            'nombre',
        ]


class TipoObraSocialSerializer(serializers.ModelSerializer):

    id = serializers.IntegerField(
        source='id_tipo_os',
        read_only=True
    )

    nombre = serializers.CharField(
        source='tipo',
        read_only=True
    )

    class Meta:
        model = TipoObraSocial
        fields = [
            'id',
            'nombre',
        ]


class ObraSocialSerializer(serializers.ModelSerializer):

    id = serializers.IntegerField(
        source='id_obra_social',
        read_only=True
    )

    tipo = TipoObraSocialSerializer(
        read_only=True
    )

    estado = EstadoObraSocialSerializer(
        read_only=True
    )

    tipo_id = serializers.PrimaryKeyRelatedField(
        source='tipo',
        queryset=TipoObraSocial.objects.all(),
        write_only=True,
        required=False
    )

    estado_id = serializers.PrimaryKeyRelatedField(
        source='estado',
        queryset=EstadoObraSocial.objects.all(),
        write_only=True,
        required=False
    )

    cantidad_pacientes = serializers.SerializerMethodField()

    def get_cantidad_pacientes(self, obj):
        return getattr(obj, 'pacientes_count', None) or obj.paciente_set.count()

    def create(self, validated_data):
        if 'tipo' not in validated_data:
            validated_data['tipo'] = TipoObraSocial.objects.first()
        if 'estado' not in validated_data:
            validated_data['estado'] = EstadoObraSocial.objects.get(pk=1)
        return super().create(validated_data)

    class Meta:
        model = ObraSocial

        fields = [
            'id',
            'nombre',
            'contacto',
            'mail',
            'web',
            'tipo',
            'estado',
            'tipo_id',
            'estado_id',
            'cantidad_pacientes',
        ]

    def validate_nombre(self, value):
        duplicado = ObraSocialService.nombre_duplicado(
            nombre=value,
            excluir_id=(
                self.instance.pk
                if self.instance
                else None
            )
        )

        if duplicado:
            raise serializers.ValidationError(
                'Ya existe una obra social con ese nombre.'
            )

        return value

    def validate(self, attrs):

        estado = attrs.get(
            'estado',
            self.instance.estado if self.instance else None
        )

        if (
            estado is not None
            and estado.descripcion.casefold() == 'inactiva'
            and self.instance is None
        ):
            raise serializers.ValidationError({
                'estado_id': (
                    'No se puede crear una obra social inactiva.'
                )
            })

        return attrs
