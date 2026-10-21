from rest_framework import serializers

from pacientes.models import (
    Paciente,
    PacienteTutor,
    Parentesco,
)


class RelacionTutorEntradaSerializer(serializers.Serializer):
    paciente_id = serializers.PrimaryKeyRelatedField(
        source='paciente',
        queryset=Paciente.objects.all()
    )

    parentesco_id = serializers.PrimaryKeyRelatedField(
        source='parentesco',
        queryset=Parentesco.objects.all()
    )

    responsable_principal = serializers.BooleanField(
        default=False
    )

    activo = serializers.BooleanField(
        required=False
    )

    def validate(self, attrs):
        relacion_actual = self.instance

        paciente = attrs.get(
            'paciente',
            relacion_actual.paciente if relacion_actual else None
        )

        parentesco = attrs.get(
            'parentesco',
            relacion_actual.parentesco if relacion_actual else None
        )

        responsable_principal = attrs.get(
            'responsable_principal',
            (
                relacion_actual.responsable_principal
                if relacion_actual else False
            )
        )

        activo = attrs.get(
            'activo',
            relacion_actual.activo if relacion_actual else True
        )

        # Una relación existente no puede cambiar de paciente.
        if (
            relacion_actual is not None
            and paciente.pk != relacion_actual.paciente_id
        ):
            raise serializers.ValidationError({
                'paciente_id': (
                    'No se puede cambiar el paciente de una '
                    'relación existente. Debe gestionarse '
                    'mediante una relación independiente.'
                )
            })

        # Impide repetir una relación tutor-paciente.
        if relacion_actual is not None:
            relacion_duplicada = PacienteTutor.objects.filter(
                tutor_id=relacion_actual.tutor_id,
                paciente=paciente,
            ).exclude(
                pk=relacion_actual.pk
            )

            if relacion_duplicada.exists():
                raise serializers.ValidationError({
                    'paciente_id': (
                        'Ya existe una relación entre este '
                        'tutor y el paciente indicado.'
                    )
                })

        # Solo puede haber un responsable principal activo
        # por paciente.
        if activo and responsable_principal:
            responsables = PacienteTutor.objects.filter(
                paciente=paciente,
                activo=True,
                responsable_principal=True,
            )

            if relacion_actual is not None:
                responsables = responsables.exclude(
                    pk=relacion_actual.pk
                )

            if responsables.exists():
                raise serializers.ValidationError({
                    'responsable_principal': (
                        'El paciente ya tiene otro tutor '
                        'responsable principal activo.'
                    )
                })

        return attrs