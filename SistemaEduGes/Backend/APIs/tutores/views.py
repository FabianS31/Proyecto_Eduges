from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pacientes.models import Tutor, PacienteTutor, Parentesco
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import AsignacionProfesional

from APIs.tutores.serializers import (
    TutorSerializer,
    TutorEntradaSerializer,
    RelacionTutorEntradaSerializer,
    RelacionTutorSerializer,
    ParentescoTutorSerializer,
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


class ParentescoListView(APIView):
    permission_classes = [IsAuthenticated, PuedeGestionarTutores]

    def get(self, request):
        parentescos = Parentesco.objects.order_by('descripcion', 'pk')
        return Response(ParentescoTutorSerializer(parentescos, many=True).data)


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

    @transaction.atomic
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
            usuario=usuario,
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

    def _verificar_acceso_profesional(self, request, tutor, bloquear=False):
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

            if bloquear:
                paciente_id = PacienteTutor.objects.filter(
                    tutor=tutor, paciente_id__in=pacientes_ids, activo=True,
                ).order_by('paciente_id').values_list('paciente_id', flat=True).first()
                if paciente_id is None:
                    return False, None
                TutorService.bloquear_paciente(paciente_id, usuario)
                if not PacienteTutor.objects.filter(tutor=tutor, paciente_id=paciente_id, activo=True).exists():
                    return False, None

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

    @transaction.atomic
    def patch(self, request, pk):
        tutor = self.get_tutor(pk)

        acceso, pacientes_ids = self._verificar_acceso_profesional(
            request,
            tutor,
            bloquear=True,
        )
        if not acceso:
            return Response(
                {'detail': 'No tenés permiso para modificar este tutor.'},
                status=status.HTTP_403_FORBIDDEN
            )

        tutor = Tutor.objects.select_for_update().get(pk=tutor.pk)
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
        relacion = get_object_or_404(
            PacienteTutor,
            id_paciente_tutor=pk,
        )

        TutorService.bloquear_paciente(relacion.paciente_id, self.request.user)
        relacion = PacienteTutor.objects.select_for_update().get(pk=relacion.pk)

        usuario = self.request.user
        if getattr(getattr(usuario, 'rol', None), 'rol', None) == 'Profesional':
            # Autorizar sobre el paciente guardado, nunca sobre el ID del cuerpo.
            # Se conserva el criterio de asignación vigente usado en el alta.
            asignado = AsignacionProfesional.objects.filter(
                profesional__usuario=usuario,
                paciente_id=relacion.paciente_id,
                fecha_fin__isnull=True,
            ).exists()
            if not asignado:
                raise PermissionDenied(
                    'Solo podés gestionar relaciones de tutores de pacientes '
                    'asignados a vos.'
                )

        return relacion

    @transaction.atomic
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
            usuario=request.user,
        )

        return Response(
            RelacionTutorSerializer(relacion).data,
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def delete(self, request, pk):
        relacion = self.get_relacion(pk)

        relacion = TutorService.dar_baja_relacion(relacion, usuario=request.user)

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


class ReemplazoPrincipalEntradaSerializer(serializers.Serializer):
    nueva_relacion_id = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        if set(self.initial_data) != {'nueva_relacion_id'}:
            raise serializers.ValidationError('Indicá solamente nueva_relacion_id.')
        return attrs


class ReemplazarPrincipalView(RelacionTutorDetailView):
    http_method_names = ['post', 'options']

    @transaction.atomic
    def post(self, request, pk):
        relacion = self.get_relacion(pk)
        serializer = ReemplazoPrincipalEntradaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        nueva = TutorService.reemplazar_principal(
            relacion, serializer.validated_data['nueva_relacion_id'], request.user,
        )
        return Response(RelacionTutorSerializer(nueva).data)
