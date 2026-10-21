from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pacientes.models import Tutor, PacienteTutor

from APIs.tutores.serializers import (
    TutorSerializer,
    TutorEntradaSerializer,
    RelacionTutorEntradaSerializer,
    RelacionTutorSerializer,
)

from APIs.tutores.services import TutorService


class PuedeGestionarTutores(BasePermission):
    """
    Autoriza la gestión de tutores para los tres roles definidos.
    """

    ROLES_PERMITIDOS = (
        'Administrador',
        'Profesional',
        'SuperAdministrador',
    )

    def has_permission(self, request, view):
        usuario = request.user

        if not usuario or not usuario.is_authenticated:
            return False

        rol = getattr(usuario, 'rol', None)

        return (
            rol is not None
            and getattr(rol, 'rol', None) in self.ROLES_PERMITIDOS
        )


class TutorListCreateView(APIView):
    permission_classes = [IsAuthenticated, PuedeGestionarTutores]

    def get(self, request):
        tutores = Tutor.objects.all().order_by('id_tutor')
        serializer = TutorSerializer(tutores, many=True)

        return Response(serializer.data)

    def post(self, request):
        tutor_serializer = TutorEntradaSerializer(data=request.data)
        tutor_serializer.is_valid(raise_exception=True)

        relacion_serializer = RelacionTutorEntradaSerializer(
            data=request.data
        )
        relacion_serializer.is_valid(raise_exception=True)

        tutor = TutorService.crear_tutor(
            datos_tutor=tutor_serializer.validated_data,
            datos_relacion=relacion_serializer.validated_data,
        )

        return Response(
            TutorSerializer(tutor).data,
            status=status.HTTP_201_CREATED,
        )


class TutorDetailView(APIView):
    permission_classes = [IsAuthenticated, PuedeGestionarTutores]

    def get_tutor(self, pk):
        return get_object_or_404(Tutor, id_tutor=pk)

    def get(self, request, pk):
        tutor = self.get_tutor(pk)

        return Response(TutorSerializer(tutor).data)

    def patch(self, request, pk):
        tutor = self.get_tutor(pk)

        serializer = TutorEntradaSerializer(
            tutor,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)

        tutor = TutorService.actualizar_tutor(
            tutor,
            serializer.validated_data,
        )

        return Response(TutorSerializer(tutor).data)


class RelacionTutorDetailView(APIView):
    permission_classes = [IsAuthenticated, PuedeGestionarTutores]

    def get_relacion(self, pk):
        return get_object_or_404(
            PacienteTutor,
            id_paciente_tutor=pk,
        )

    def patch(self, request, pk):
        relacion = self.get_relacion(pk)

        datos = {
            'paciente_id': relacion.paciente_id,
            'parentesco_id': relacion.parentesco_id,
            'responsable_principal': (
                relacion.responsable_principal
            ),
            'activo': relacion.activo,
        }
        datos.update(request.data)

        serializer = RelacionTutorEntradaSerializer(
            instance=relacion,
            data=datos,
        )
        serializer.is_valid(raise_exception=True)

        relacion = TutorService.actualizar_relacion(
            relacion,
            serializer.validated_data,
        )

        return Response(
            RelacionTutorSerializer(relacion).data,
            status=status.HTTP_200_OK,
        )

    def delete(self, request, pk):
        relacion = self.get_relacion(pk)

        TutorService.dar_baja_relacion(relacion)

        return Response(
            {
                'mensaje': (
                    'La relación entre el tutor y el paciente '
                    'se dio de baja correctamente.'
                ),
                'id': relacion.id_paciente_tutor,
                'activo': relacion.activo,
            },
            status=status.HTTP_200_OK,
        )