
from rest_framework import serializers

from turnos.models import RegistroSesion, Turno


class TurnosPendientesFiltroSerializer(serializers.Serializer):
    fecha_desde = serializers.DateField(required=False)
    fecha_hasta = serializers.DateField(required=False)
    paciente_id = serializers.IntegerField(required=False, min_value=1)

    def validate(self, attrs):
        desde, hasta = attrs.get('fecha_desde'), attrs.get('fecha_hasta')
        if desde is not None and hasta is not None and desde > hasta:
            raise serializers.ValidationError({
                'fecha_hasta': 'La fecha Desde no puede ser posterior a la fecha Hasta.'
            })
        return attrs


class HistorialSesionFiltroSerializer(serializers.Serializer):
    paciente_id = serializers.IntegerField(min_value=1)


class TextoSesionField(serializers.CharField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail('invalid')
        return super().to_internal_value(data)


class RegistroSesionEdicionSerializer(serializers.Serializer):
    trabajo_sesion = TextoSesionField()
    diagnostico = TextoSesionField(write_only=True)
    nota_sesion = TextoSesionField(required=False, allow_null=True, allow_blank=True, write_only=True)

    def validate(self, attrs):
        desconocidos = set(self.initial_data) - set(self.fields)
        if desconocidos:
            raise serializers.ValidationError({campo: 'Este campo no se puede modificar.' for campo in desconocidos})
        return attrs


class IdentificadorTurnoField(serializers.PrimaryKeyRelatedField):
    def to_internal_value(self, data):
        # Conservar la conversión del PK anterior sin consultar su existencia.
        # La resolución y autorización se realizan juntas en el servicio.
        if isinstance(data, bool):
            self.fail('incorrect_type', data_type=type(data).__name__)
        try:
            return Turno._meta.pk.get_prep_value(data)
        except (TypeError, ValueError):
            self.fail('incorrect_type', data_type=type(data).__name__)


class RegistroSesionEntradaSerializer(RegistroSesionEdicionSerializer):
    """
    Valida los datos necesarios para registrar una sesión.
    La autorización y las reglas de negocio se verifican
    posteriormente en el servicio.
    """

    turno_id = IdentificadorTurnoField(queryset=Turno.objects.all(), write_only=True)


class RegistroSesionProfesionalSerializer(
    serializers.ModelSerializer
):
    """
    Respuesta completa destinada exclusivamente al profesional
    autorizado para consultar el registro.
    """

    id = serializers.IntegerField(
        source='id_registro_sesion',
        read_only=True,
    )

    class Meta:
        model = RegistroSesion
        fields = [
            'id',
            'trabajo_sesion',
            'diagnostico',
            'nota_sesion',
        ]
        read_only_fields = fields


class RegistroSesionResumenSerializer(
    serializers.ModelSerializer
):
    """
    Resumen diagnóstico autorizado. No expone trabajo ni notas privadas.
    """

    id = serializers.IntegerField(
        source='id_registro_sesion',
        read_only=True,
    )

    class Meta:
        model = RegistroSesion
        fields = [
            'id',
            'diagnostico',
        ]
        read_only_fields = fields
