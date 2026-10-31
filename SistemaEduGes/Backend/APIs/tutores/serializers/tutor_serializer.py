from rest_framework import serializers

from pacientes.models import (
    Tutor,
    PacienteTutor,
    Parentesco,
    Paciente,
)


class ParentescoTutorSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source='id_parentesco', read_only=True)
    nombre = serializers.CharField(
        source='descripcion',
        read_only=True
    )

    class Meta:
        model = Parentesco
        fields = [
            'id',
            'nombre',
        ]


class PacienteTutorResumenSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(
        source='id_paciente',
        read_only=True
    )

    class Meta:
        model = Paciente
        fields = [
            'id',
            'nombre',
            'apellido',
        ]


class RelacionTutorSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(
        source='id_paciente_tutor',
        read_only=True
    )

    paciente = PacienteTutorResumenSerializer(read_only=True)
    parentesco = ParentescoTutorSerializer(read_only=True)

    class Meta:
        model = PacienteTutor
        fields = [
            'id',
            'paciente',
            'parentesco',
            'responsable_principal',
            'activo',
        ]


class TutorSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(
        source='id_tutor',
        read_only=True
    )

    relaciones = serializers.SerializerMethodField()

    class Meta:
        model = Tutor
        fields = [
            'id',
            'nombre',
            'apellido',
            'dni',
            'telefono',
            'movil',
            'mail',
            'domicilio',
            'relaciones',
        ]

    def get_relaciones(self, obj):
        relaciones = (
            PacienteTutor.objects
            .filter(tutor=obj, activo=True)
            .select_related('paciente', 'parentesco')
            .order_by('id_paciente_tutor')
        )

        pacientes_ids = self.context.get('pacientes_ids')
        if pacientes_ids is not None:
            relaciones = relaciones.filter(paciente_id__in=pacientes_ids)

        return RelacionTutorSerializer(
            relaciones,
            many=True
        ).data
