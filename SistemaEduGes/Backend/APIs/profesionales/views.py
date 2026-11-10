from rest_framework import generics, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated

from profesionales.models.profesional_model import Profesional
from APIs.profesionales.serializers.profesionales_serializer import ProfesionalSerializer
from APIs.autenticacion.permisos import TienePermiso
from APIs.profesionales.permisos import validar_edicion_cuenta
from APIs.servicios.estado_entidad_service import EstadoEntidadService
from APIs.turnos.services.turno_service import TurnoService
from APIs.turnos.serializers.turno_serializer import TurnoSerializer


class ProfesionalListCreateView(generics.ListCreateAPIView):
    queryset = Profesional.objects.all()
    serializer_class = ProfesionalSerializer
    permission_classes = [TienePermiso]

    def get_permissions(self):
        self.permiso_requerido = (
            'profesionales.ver'
            if self.request.method == 'GET'
            else 'profesionales.crear'
        )

        return super().get_permissions()


class ProfesionalDetailView(generics.RetrieveUpdateAPIView):
    queryset = Profesional.objects.all()
    serializer_class = ProfesionalSerializer
    permission_classes = [TienePermiso]

    def get_object(self):
        profesional = super().get_object()
        if self.request.method in ('PUT', 'PATCH'):
            validar_edicion_cuenta(self.request.user, profesional)
        return profesional

    def get_permissions(self):
        if self.request.method in ['PUT', 'PATCH']:
            self.permiso_requerido = 'profesionales.edit'
        else:
            self.permiso_requerido = 'profesionales.ver'

        return super().get_permissions()


class ProfesionalEstadoView(APIView):
    permission_classes = [TienePermiso]

    def get_permissions(self):
        self.permiso_requerido = 'profesionales.edit'
        return super().get_permissions()

    def patch(self, request, pk):
        profesional = Profesional.objects.select_related('rol', 'usuario__rol').filter(pk=pk).first()
        if profesional is not None:
            validar_edicion_cuenta(request.user, profesional)

        nuevo_estado = request.data.get('estado')

        if nuevo_estado is None:
            raise ValidationError({
                'estado': 'Este campo es obligatorio.'
            })

        profesional = EstadoEntidadService.cambiar_estado_profesional(
            id_profesional=pk,
            nuevo_estado=nuevo_estado
        )

        return Response({
            'mensaje': 'Estado del profesional actualizado correctamente.',
            'id_profesional': profesional.id_profesional,
            'estado': profesional.estado_profesional.estado,
        }, status=status.HTTP_200_OK)


class ProfesionalesParaReasignacionView(APIView):
    """
    Devuelve los profesionales activos disponibles para recibir
    una reasignación.

    Solo devuelve ID, nombre y apellido.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        nombre_rol = getattr(
            getattr(request.user, 'rol', None),
            'rol',
            None,
        )

        if nombre_rol != 'Profesional':
            return Response(
                {
                    'detail': (
                        'Solo los profesionales pueden consultar '
                        'la lista para reasignar pacientes.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        profesional_actual = TurnoService.obtener_profesional_usuario(
            request.user
        )

        TurnoService.validar_profesional_activo(
            profesional_actual
        )

        profesionales = (
            Profesional.objects
            .filter(estado_profesional__estado='Activo')
            .exclude(pk=profesional_actual.pk)
            .order_by('apellido', 'nombre')
            .values(
                'id_profesional',
                'nombre',
                'apellido',
            )
        )

        return Response(list(profesionales))


class ReasignacionPacienteView(APIView):
    """
    Reasigna un paciente al profesional indicado.

    La operación transfiere también los turnos futuros
    Pendientes y Confirmados.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, paciente_id):
        profesional_id = request.data.get('profesional_id')

        if profesional_id is None:
            raise ValidationError({
                'profesional_id': (
                    'Debés indicar el profesional que recibirá '
                    'al paciente.'
                )
            })

        try:
            profesional_id = int(profesional_id)
        except (TypeError, ValueError):
            raise ValidationError({
                'profesional_id': (
                    'El identificador del profesional debe ser numérico.'
                )
            })

        resultado = TurnoService.reasignar_paciente(
            paciente_id=paciente_id,
            profesional_destino_id=profesional_id,
            usuario=request.user,
        )

        turnos = (
            TurnoService.obtener_turnos_reasignados(
                resultado['turnos_ids']
            )
        )

        turnos_serializados = TurnoSerializer(
            turnos,
            many=True,
        ).data

        conflictos = [
            turno
            for turno in turnos_serializados
            if turno['tiene_conflicto_horario']
        ]

        return Response(
            {
                'mensaje': (
                    'El paciente fue reasignado correctamente.'
                ),
                'id_paciente': paciente_id,
                'profesional_anterior': {
                    'id': resultado['profesional_anterior'].id_profesional,
                    'nombre': resultado['profesional_anterior'].nombre,
                    'apellido': resultado['profesional_anterior'].apellido,
                },
                'profesional_nuevo': {
                    'id': resultado['profesional_nuevo'].id_profesional,
                    'nombre': resultado['profesional_nuevo'].nombre,
                    'apellido': resultado['profesional_nuevo'].apellido,
                },
                'cantidad_turnos_reasignados': len(turnos_serializados),
                'cantidad_turnos_con_conflicto': len(conflictos),
                'turnos': turnos_serializados,
                'conflictos': conflictos,
            },
            status=status.HTTP_200_OK,
        )
