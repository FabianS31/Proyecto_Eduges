from rest_framework import serializers


class ReporteTurnosFiltroSerializer(serializers.Serializer):
    """
    Valida los filtros opcionales para reportes de turnos.
    Todos los filtros pueden combinarse.
    """

    estado_id = serializers.IntegerField(
        required=False,
        min_value=1,
    )

    paciente_id = serializers.IntegerField(
        required=False,
        min_value=1,
    )

    profesional_id = serializers.IntegerField(
        required=False,
        min_value=1,
    )

    nombre = serializers.CharField(
        required=False,
        max_length=100,
        allow_blank=False,
    )

    apellido = serializers.CharField(
        required=False,
        max_length=100,
        allow_blank=False,
    )

    fecha_desde = serializers.DateField(
        required=False,
    )

    trabajo_sesion = serializers.CharField(
        required=False,
        max_length=200,
        allow_blank=True,
    )

    fecha_hasta = serializers.DateField(
        required=False,
    )

    def validate(self, attrs):
        fecha_desde = attrs.get('fecha_desde')
        fecha_hasta = attrs.get('fecha_hasta')

        if (
            fecha_desde is not None
            and fecha_hasta is not None
            and fecha_desde > fecha_hasta
        ):
            raise serializers.ValidationError({
                'fecha_hasta': (
                    'La fecha hasta no puede ser anterior '
                    'a la fecha desde.'
                )
            })

        return attrs


class ReporteAlumnosFiltroSerializer(serializers.Serializer):
    """
    Valida los filtros opcionales para reportes de pacientes.
    """

    paciente_id = serializers.IntegerField(
        required=False,
        min_value=1,
    )

    nombre = serializers.CharField(
        required=False,
        max_length=100,
        allow_blank=False,
    )

    apellido = serializers.CharField(
        required=False,
        max_length=100,
        allow_blank=False,
    )

    dni = serializers.CharField(
        required=False,
        max_length=20,
        allow_blank=False,
    )

    estado_id = serializers.IntegerField(
        required=False,
        min_value=1,
    )

    fecha_alta_desde = serializers.DateField(
        required=False,
    )

    fecha_alta_hasta = serializers.DateField(
        required=False,
    )

    obra_social_id = serializers.IntegerField(
        required=False,
        min_value=1,
    )


class ReporteProfesionalesFiltroSerializer(serializers.Serializer):
    """
    Valida los filtros opcionales para reportes de profesionales.
    """

    profesional_id = serializers.IntegerField(
        required=False,
        min_value=1,
    )

    nombre = serializers.CharField(
        required=False,
        max_length=100,
        allow_blank=False,
    )

    apellido = serializers.CharField(
        required=False,
        max_length=100,
        allow_blank=False,
    )

    dni = serializers.CharField(
        required=False,
        max_length=20,
        allow_blank=False,
    )

    matricula = serializers.CharField(
        required=False,
        max_length=50,
        allow_blank=False,
    )

    especialidad_id = serializers.IntegerField(
        required=False,
        min_value=1,
    )

    estado_id = serializers.IntegerField(
        required=False,
        min_value=1,
    )