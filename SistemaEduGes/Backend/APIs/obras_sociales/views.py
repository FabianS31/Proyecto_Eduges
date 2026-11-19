
import logging

from django.db import IntegrityError
from APIs.servicios.conflictos_unicidad import campo_duplicado
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from APIs.autenticacion.autenticacion import (
    UsuarioSessionAuthentication,
)
from APIs.autenticacion.permisos import TienePermiso

from APIs.obras_sociales.serializers.obra_social_serializer import (
    ObraSocialSerializer,
)
from APIs.obras_sociales.services.obra_social_service import (
    ObraSocialService,
)

from pacientes.models.obra_social_model import ObraSocial


logger = logging.getLogger(__name__)


def respuesta_integridad(error):
    duplicado = campo_duplicado(error, [
        (ObraSocial, 'nombre', 'nombre', 'Ya existe una obra social con ese nombre.'),
    ])
    if duplicado is not None:
        return Response(
            {'codigo': 'obra_social_duplicada', 'detail': duplicado[1]},
            status=status.HTTP_409_CONFLICT,
        )
    logger.exception('Error de integridad al guardar una obra social.')
    return Response(
        {'codigo': 'error_integridad',
         'detail': 'No se pudo guardar la obra social por un problema de integridad del servidor. Contacte a administraci\u00f3n.'},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


class ObraSocialListView(APIView):

    authentication_classes = [UsuarioSessionAuthentication]
    permission_classes = [IsAuthenticated, TienePermiso]

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAuthenticated()]
        self.permiso_requerido = 'obras_sociales.edit'
        return [IsAuthenticated(), TienePermiso()]

    def get(self, request):

        estado_id = request.query_params.get('estado')

        if estado_id is not None:
            try:
                estado_id = int(estado_id)
                if estado_id < 1:
                    raise ValueError
            except (TypeError, ValueError):
                return Response(
                    {
                        'estado': [
                            'Debe indicar un identificador válido.'
                        ]
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

        obras_sociales = ObraSocialService.listar(
            estado_id=estado_id
        )

        serializer = ObraSocialSerializer(
            obras_sociales,
            many=True
        )

        return Response(
            serializer.data,
            status=status.HTTP_200_OK
        )

    def post(self, request):
        serializer = ObraSocialSerializer(
            data=request.data
        )

        try:
            with ObraSocialService.escritura_serializada():
                serializer.is_valid(raise_exception=True)
                obra_social = serializer.save()

        except IntegrityError as error:
            return respuesta_integridad(error)

        return Response(
            ObraSocialSerializer(obra_social).data,
            status=status.HTTP_201_CREATED
        )


class ObraSocialDetailView(APIView):

    authentication_classes = [UsuarioSessionAuthentication]
    permission_classes = [IsAuthenticated, TienePermiso]

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAuthenticated()]
        self.permiso_requerido = 'obras_sociales.edit'
        return [IsAuthenticated(), TienePermiso()]

    def get_object(self, obra_social_id):
        return get_object_or_404(
            ObraSocial.objects.select_related(
                'tipo',
                'estado',
            ),
            pk=obra_social_id
        )

    def get(self, request, obra_social_id):
        obra_social = self.get_object(
            obra_social_id
        )

        return Response(
            ObraSocialSerializer(obra_social).data,
            status=status.HTTP_200_OK
        )

    def patch(self, request, obra_social_id):
        try:
            with ObraSocialService.escritura_serializada():
                obra_social = self.get_object(obra_social_id)
                serializer = ObraSocialSerializer(
                    obra_social, data=request.data, partial=True
                )
                serializer.is_valid(raise_exception=True)
                obra_social = serializer.save()

        except IntegrityError as error:
            return respuesta_integridad(error)

        return Response(
            ObraSocialSerializer(obra_social).data,
            status=status.HTTP_200_OK
        )
