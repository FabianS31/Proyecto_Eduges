from rest_framework import serializers

from turnos.models import Turno
from APIs.turnos.services.turno_service import TurnoService


class TurnoSerializer(serializers.ModelSerializer):

    paciente = serializers.PrimaryKeyRelatedField(
        queryset=Turno._meta.get_field('paciente')
        .remote_field.model.objects.all(),
        write_only=True,
    )

    profesional = serializers.PrimaryKeyRelatedField(
        queryset=Turno._meta.get_field('profesional')
        .remote_field.model.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )

    paciente_id = serializers.IntegerField(
        source='paciente.id_paciente',
        read_only=True,
    )

    profesional_id = serializers.IntegerField(
        source='profesional.id_profesional',
        read_only=True,
    )

    estado = serializers.CharField(
        source='estado.estado',
        read_only=True,
    )

    class Meta:
        model = Turno

        fields = [
            'id_turno',
            'fecha',
            'hora',
            'paciente',
            'paciente_id',
            'profesional',
            'profesional_id',
            'estado',
        ]

        read_only_fields = [
            'id_turno',
            'paciente_id',
            'profesional_id',
            'estado',
        ]

    def create(self, validated_data):
        usuario = self.context['request'].user

        paciente = validated_data.pop('paciente')
        profesional = validated_data.pop(
            'profesional',
            None,
        )

        turno = TurnoService.crear_turno(
            fecha=validated_data['fecha'],
            hora=validated_data['hora'],
            paciente_id=paciente.pk,
            usuario=usuario,
            profesional_id=(
                profesional.pk
                if profesional is not None
                else None
            ),
        )

        return turno