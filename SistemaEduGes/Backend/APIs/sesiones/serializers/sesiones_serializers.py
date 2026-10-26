
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

    trabajo_sesion = serializers.CharField(
        max_length=225,
    )

    resultado = serializers.CharField(
        max_length=225,
        write_only=True,
    )

    nota_especial = serializers.CharField(
        max_length=225,
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
            'resultado',
            'nota_especial',
        ]
        read_only_fields = fields


class RegistroSesionResumenSerializer(
    serializers.ModelSerializer
):
    """
    Respuesta general sin información privada.
    No expone resultado ni nota_especial.
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