
from rest_framework import serializers
from APIs.servicios.errores_catalogo import CatalogoNoDisponible

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

    mail = serializers.EmailField(max_length=150, required=False, allow_null=True, allow_blank=True)
    web = serializers.URLField(max_length=255, required=False, allow_null=True, allow_blank=True)

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

        if self.instance is None:
            # El formulario sencillo no elige tipo. No hay un default institucional
            # configurado: solamente un candidato válido permite resolverlo.
            if 'tipo' not in attrs:
                tipos = [tipo for tipo in TipoObraSocial.objects.all()
                         if tipo.tipo is not None and tipo.tipo.strip()]
                if len(tipos) != 1:
                    raise CatalogoNoDisponible(
                        'Debe existir un único tipo válido de cobertura o definirse un tipo predeterminado institucional. Contacte a administración.',
                        'configuracion_catalogo',
                    )
                attrs['tipo'] = tipos[0]
            if 'estado' not in attrs or (
                attrs['estado'].descripcion is not None
                and attrs['estado'].descripcion.strip().casefold() == 'activa'
            ):
                activos = [estado for estado in EstadoObraSocial.objects.all()
                           if estado.descripcion is not None
                           and estado.descripcion.strip().casefold() == 'activa']
                if len(activos) != 1:
                    raise CatalogoNoDisponible(
                        'Debe existir una única entrada Activa en los estados de obra social. Contacte a administración.',
                        'configuracion_catalogo',
                    )
                attrs['estado'] = activos[0]

        tipo = attrs.get('tipo', getattr(self.instance, 'tipo', None))
        if tipo is None or tipo.tipo is None or not tipo.tipo.strip():
            raise CatalogoNoDisponible(
                'El tipo de obra social no tiene descripción. Contacte a administración.'
            )

        estado = attrs.get(
            'estado',
            getattr(self.instance, 'estado', None)
        )

        if estado is None or estado.descripcion is None or not estado.descripcion.strip():
            raise CatalogoNoDisponible(
                'El estado de obra social no tiene descripción. Contacte a administración.'
            )

        if (
            estado is not None
            and estado.descripcion.strip().casefold() != 'activa'
            and self.instance is None
        ):
            raise serializers.ValidationError({
                'estado_id': (
                    'Toda obra social nueva debe registrarse como Activa.'
                )
            })

        return attrs
