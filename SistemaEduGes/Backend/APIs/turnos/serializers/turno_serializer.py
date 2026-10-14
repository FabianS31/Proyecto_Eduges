
from rest_framework import serializers

from turnos.models import Turno
from APIs.turnos.services.turno_service import TurnoService


class TurnoSerializer(serializers.ModelSerializer):

    fecha = serializers.DateField(required=False)
    hora = serializers.TimeField(required=False)

    paciente = serializers.PrimaryKeyRelatedField(
        queryset=Turno._meta.get_field('paciente')
        .remote_field.model.objects.all(),
        write_only=True,
    )

    profesional = serializers.PrimaryKeyRelatedField(
        queryset=Turno._meta.get_field('profesional')
        .remote_field.model.objects.all(),
        required=False,
        write_only=True,
    )

    turnos = serializers.ListField(
        child=serializers.DictField(),
        write_only=True,
        required=False,
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
            'turnos',
        ]

        read_only_fields = [
            'id_turno',
            'paciente_id',
            'profesional_id',
            'estado',
        ]

    def validate(self, attrs):
        # Edición de un turno existente: PUT o PATCH.
        if self.instance is not None:

            if 'turnos' in attrs:
                raise serializers.ValidationError({
                    'turnos': (
                        'La edición permite modificar un solo turno '
                        'por solicitud.'
                    )
                })

            if not self.partial:
                campos_requeridos = [
                    'fecha',
                    'hora',
                    'paciente',
                ]

                faltantes = [
                    campo
                    for campo in campos_requeridos
                    if campo not in attrs
                ]

                if faltantes:
                    raise serializers.ValidationError({
                        campo: 'Este campo es obligatorio para PUT.'
                        for campo in faltantes
                    })

            else:
                campos_editables = {
                    'fecha',
                    'hora',
                    'paciente',
                    'profesional',
                }

                if not campos_editables.intersection(attrs):
                    raise serializers.ValidationError({
                        'detail': (
                            'Debés enviar al menos un campo '
                            'para modificar el turno.'
                        )
                    })

            return attrs

        # Creación de turnos: POST individual o múltiple.
        tiene_lista = 'turnos' in attrs
        tiene_fecha = 'fecha' in attrs
        tiene_hora = 'hora' in attrs

        if tiene_lista:
            if tiene_fecha or tiene_hora:
                raise serializers.ValidationError({
                    'detail': (
                        'Enviá turnos o fecha y hora, '
                        'pero no ambas modalidades.'
                    )
                })

        elif not tiene_fecha or not tiene_hora:
            raise serializers.ValidationError({
                'detail': (
                    'Debés enviar una lista turnos o '
                    'los campos fecha y hora para un turno.'
                )
            })

        return attrs

    def validate_turnos(self, value):
        if not value:
            raise serializers.ValidationError(
                'Debés indicar al menos un turno.'
            )

        turnos_validados = []

        for indice, turno in enumerate(value):
            if 'fecha' not in turno or 'hora' not in turno:
                raise serializers.ValidationError({
                    indice: (
                        'Cada turno debe incluir fecha y hora.'
                    )
                })

            fecha = serializers.DateField().run_validation(
                turno['fecha']
            )

            hora = serializers.TimeField().run_validation(
                turno['hora']
            )

            turnos_validados.append({
                'fecha': fecha,
                'hora': hora,
            })

        return turnos_validados

    def create(self, validated_data):
        usuario = self.context['request'].user

        paciente = validated_data.pop('paciente')
        profesional = validated_data.pop(
            'profesional',
            None,
        )

        turnos = validated_data.pop('turnos', None)

        profesional_id = (
            profesional.pk
            if profesional is not None
            else None
        )

        if turnos is not None:
            return TurnoService.crear_turnos(
                turnos=turnos,
                paciente_id=paciente.pk,
                usuario=usuario,
                profesional_id=profesional_id,
            )

        return TurnoService.crear_turno(
            fecha=validated_data['fecha'],
            hora=validated_data['hora'],
            paciente_id=paciente.pk,
            usuario=usuario,
            profesional_id=profesional_id,
        )

    def update(self, instance, validated_data):
        usuario = self.context['request'].user

        fecha = validated_data.get(
            'fecha',
            instance.fecha,
        )

        hora = validated_data.get(
            'hora',
            instance.hora,
        )

        paciente = validated_data.get(
            'paciente',
            instance.paciente,
        )

        profesional = validated_data.get(
            'profesional',
        )

        profesional_id = (
            profesional.pk
            if profesional is not None
            else None
        )

        return TurnoService.editar_turno(
            turno_id=instance.pk,
            fecha=fecha,
            hora=hora,
            paciente_id=paciente.pk,
            usuario=usuario,
            profesional_id=profesional_id,
        )