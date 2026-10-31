
from django.db import IntegrityError, transaction
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

        serializer.is_valid(raise_exception=True)

        try:
            with transaction.atomic():
                obra_social = serializer.save()

        except IntegrityError:
            return Response(
                {
                    'codigo': 'obra_social_duplicada',
                    'detail': (
                        'Ya existe una obra social con ese nombre.'
                    )
                },
                status=status.HTTP_409_CONFLICT
            )

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
        obra_social = self.get_object(
            obra_social_id
        )

        serializer = ObraSocialSerializer(
            obra_social,
            data=request.data,
            partial=True
        )

        serializer.is_valid(raise_exception=True)

        try:
            with transaction.atomic():
                obra_social = serializer.save()

        except IntegrityError:
            return Response(
                {
                    'codigo': 'obra_social_duplicada',
                    'detail': (
                        'Ya existe una obra social con ese nombre.'
                    )
                },
                status=status.HTTP_409_CONFLICT
            )

        return Response(
            ObraSocialSerializer(obra_social).data,
            status=status.HTTP_200_OK
        )
