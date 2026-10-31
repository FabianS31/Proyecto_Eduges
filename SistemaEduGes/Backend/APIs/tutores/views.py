from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pacientes.models import Tutor, PacienteTutor
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import AsignacionProfesional

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
        usuario = request.user
        rol = getattr(usuario, 'rol', None)
        nombre_rol = getattr(rol, 'rol', None) if rol else None

        pacientes_ids = None

        if nombre_rol == 'Profesional':
            try:
                profesional = Profesional.objects.get(usuario=usuario)
            except Profesional.DoesNotExist:
                return Response([], status=status.HTTP_200_OK)

            pacientes_ids = list(
                AsignacionProfesional.objects.filter(
                    profesional=profesional,
                    fecha_fin__isnull=True
                ).values_list('paciente_id', flat=True)
            )

            tutores_ids = PacienteTutor.objects.filter(
                paciente_id__in=pacientes_ids,
                activo=True
            ).values_list('tutor_id', flat=True)

            tutores = Tutor.objects.filter(
                id_tutor__in=tutores_ids
            ).distinct().order_by('apellido', 'nombre')

        elif nombre_rol in ['Administrador', 'SuperAdministrador']:
            tutores = Tutor.objects.all().order_by('apellido', 'nombre')
        else:
            return Response(
                {'detail': 'El rol del usuario no tiene acceso a tutores.'},
                status=status.HTTP_403_FORBIDDEN
            )

        q = request.query_params.get('q') or request.query_params.get('buscar')
        if q:
            q = q.strip()
            tutores = tutores.filter(
                Q(nombre__icontains=q) |
                Q(apellido__icontains=q) |
                Q(dni__icontains=q)
            )

        serializer = TutorSerializer(
            tutores,
            many=True,
            context={
                'request': request,
                'pacientes_ids': pacientes_ids,
            }
        )

        return Response(serializer.data)

    def post(self, request):
        tutor_serializer = TutorEntradaSerializer(data=request.data)
        tutor_serializer.is_valid(raise_exception=True)

        relacion_serializer = RelacionTutorEntradaSerializer(
            data=request.data
        )
        relacion_serializer.is_valid(raise_exception=True)

        usuario = request.user
        rol = getattr(usuario, 'rol', None)
        nombre_rol = getattr(rol, 'rol', None) if rol else None
        pacientes_ids = None

        if nombre_rol == 'Profesional':
            try:
                profesional = Profesional.objects.get(usuario=usuario)
            except Profesional.DoesNotExist:
                return Response(
                    {
                        'detail': (
                            'El usuario autenticado no está '
                            'vinculado a un profesional.'
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN
                )

            paciente = relacion_serializer.validated_data['paciente']
            asignado = AsignacionProfesional.objects.filter(
                profesional=profesional,
                paciente=paciente,
                fecha_fin__isnull=True
            ).exists()

            if not asignado:
                return Response(
                    {
                        'detail': (
                            'Solo podés asociar tutores a pacientes '
                            'asignados a vos.'
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN
                )

            pacientes_ids = list(
                AsignacionProfesional.objects.filter(
                    profesional=profesional,
                    fecha_fin__isnull=True
                ).values_list('paciente_id', flat=True)
            )

        tutor = TutorService.crear_tutor(
            datos_tutor=tutor_serializer.validated_data,
            datos_relacion=relacion_serializer.validated_data,
        )

        return Response(
            TutorSerializer(
                tutor,
                context={
                    'request': request,
                    'pacientes_ids': pacientes_ids,
                }
            ).data,
            status=status.HTTP_201_CREATED,
        )


class TutorDetailView(APIView):
    permission_classes = [IsAuthenticated, PuedeGestionarTutores]

    def _verificar_acceso_profesional(self, request, tutor):
        usuario = request.user
        rol = getattr(usuario, 'rol', None)
        nombre_rol = getattr(rol, 'rol', None) if rol else None

        if nombre_rol == 'Profesional':
            profesional = Profesional.objects.filter(usuario=usuario).first()
            if not profesional:
                return False, None

            pacientes_ids = list(
                AsignacionProfesional.objects.filter(
                    profesional=profesional,
                    fecha_fin__isnull=True
                ).values_list('paciente_id', flat=True)
            )

            tiene_acceso = PacienteTutor.objects.filter(
                tutor=tutor,
                paciente_id__in=pacientes_ids,
                activo=True
            ).exists()

            return tiene_acceso, pacientes_ids

        return True, None

    def get_tutor(self, pk):
        return get_object_or_404(Tutor, id_tutor=pk)

    def get(self, request, pk):
        tutor = self.get_tutor(pk)

        acceso, pacientes_ids = self._verificar_acceso_profesional(
            request,
            tutor
        )
        if not acceso:
            return Response(
                {'detail': 'No tenés permiso para consultar este tutor.'},
                status=status.HTTP_403_FORBIDDEN
            )

        return Response(
            TutorSerializer(
                tutor,
                context={
                    'request': request,
                    'pacientes_ids': pacientes_ids,
                }
            ).data
        )

    def patch(self, request, pk):
        tutor = self.get_tutor(pk)

        acceso, pacientes_ids = self._verificar_acceso_profesional(
            request,
            tutor
        )
        if not acceso:
            return Response(
                {'detail': 'No tenés permiso para modificar este tutor.'},
                status=status.HTTP_403_FORBIDDEN
            )

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

        return Response(
            TutorSerializer(
                tutor,
                context={
                    'request': request,
                    'pacientes_ids': pacientes_ids,
                }
            ).data
        )


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
