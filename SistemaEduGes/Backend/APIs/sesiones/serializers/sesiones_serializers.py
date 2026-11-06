
from rest_framework import serializers

from turnos.models import RegistroSesion, Turno


class RegistroSesionEntradaSerializer(serializers.Serializer):
    """
    Valida los datos necesarios para registrar una sesión.
    La autorización y las reglas de negocio se verifican
    posteriormente en el servicio.
    """

    turno_id = serializers.PrimaryKeyRelatedField(
        source='turno',
        queryset=Turno.objects.all(),
        write_only=True,
    )

    trabajo_sesion = serializers.CharField()

    diagnostico = serializers.CharField(
        write_only=True,
    )

    nota_sesion = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        write_only=True,
    )


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
    Respuesta general sin información privada.
    No expone diagnostico ni nota_sesion.
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
        ]
        read_only_fields = fields