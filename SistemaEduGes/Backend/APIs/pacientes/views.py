
from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pacientes.models.paciente_model import Paciente
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import (
    AsignacionProfesional
)

from APIs.servicios.estado_entidad_service import (
    EstadoEntidadService
)

from .serializers.paciente_serializer import PacienteSerializer


class PacienteListView(APIView):

    permission_classes = [IsAuthenticated]

    
    def get(self, request):

        usuario = request.user

        if not usuario.rol:
            return Response(
                {
                    'detail': (
                        'El usuario no tiene un rol asignado.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN
            )

        nombre_rol = usuario.rol.rol

        # Parámetros de búsqueda
        buscar = request.query_params.get(
            'buscar', ''
        ).strip()

        nombre = request.query_params.get(
            'nombre', ''
        ).strip()

        apellido = request.query_params.get(
            'apellido', ''
        ).strip()

        dni = request.query_params.get(
            'dni', ''
        ).strip()

        estado = request.query_params.get(
            'estado', ''
        ).strip()

        obra_social = request.query_params.get(
            'obra_social', ''
        ).strip()

        hay_filtros = any([
            buscar,
            nombre,
            apellido,
            dni,
            estado,
            obra_social,
        ])

        # Consulta según el rol
        if nombre_rol == 'Profesional':

            try:
                profesional = Profesional.objects.select_related(
                    'estado_profesional'
                ).get(usuario=usuario)

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

            asignaciones_activas = (
                AsignacionProfesional.objects.filter(
                    profesional=profesional,
                    fecha_fin__isnull=True
                ).values('paciente_id')
            )

            pacientes = Paciente.objects.filter(
                id_paciente__in=asignaciones_activas,
                estado__estado='Activo'
            )

            # Al buscar, también permite encontrar
            # pacientes inactivos para poder reactivarlos.
            if hay_filtros:

                pacientes_inactivos = Paciente.objects.filter(
                    estado__estado='Inactivo'
                )

                pacientes = pacientes | pacientes_inactivos

        elif nombre_rol in (
            'Administrador',
            'SuperAdministrador'
        ):

            pacientes = Paciente.objects.all()

        else:
            return Response(
                {
                    'detail': (
                        'El rol del usuario no tiene '
                        'acceso al listado de pacientes.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN
            )

        # Filtro general: nombre, apellido o DNI
        if buscar:
            pacientes = pacientes.filter(
                Q(nombre__icontains=buscar)
                | Q(apellido__icontains=buscar)
                | Q(dni__icontains=buscar)
            )

        # Filtros independientes
        if nombre:
            pacientes = pacientes.filter(
                nombre__icontains=nombre
            )

        if apellido:
            pacientes = pacientes.filter(
                apellido__icontains=apellido
            )

        if dni:
            pacientes = pacientes.filter(
                dni__icontains=dni
            )

        if estado:
            if estado.isdigit():
                pacientes = pacientes.filter(
                    estado_id=int(estado)
                )
            else:
                pacientes = pacientes.filter(
                    estado__estado__iexact=estado
                )

        if obra_social:
            if not obra_social.isdigit():
                return Response(
                    {
                        'detail': (
                            'El filtro obra_social debe '
                            'contener un ID numérico.'
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            pacientes = pacientes.filter(
                obra_social_id=int(obra_social)
            )

        pacientes = pacientes.order_by(
            'apellido',
            'nombre'
        ).distinct()

        serializer = PacienteSerializer(
            pacientes,
            many=True
        )

        return Response(
            serializer.data,
            status=status.HTTP_200_OK
        )

    def post(self, request):

        usuario = request.user

        if not usuario.rol:
            return Response(
                {
                    'detail': (
                        'El usuario no tiene un rol asignado.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN
            )

        nombre_rol = usuario.rol.rol

        if nombre_rol == 'Profesional':

            try:
                profesional = Profesional.objects.select_related(
                    'estado_profesional'
                ).get(usuario=usuario)

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

            if profesional.estado_profesional.estado != 'Activo':
                return Response(
                    {
                        'detail': (
                            'Tu cuenta profesional está inactiva. '
                            'No tenés autorización para dar de '
                            'alta pacientes. Comunicate con el '
                            'administrador del sistema.'
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN
                )

        elif nombre_rol not in [
            'Administrador',
            'SuperAdministrador'
        ]:
            return Response(
                {
                    'detail': (
                        'El rol del usuario no tiene '
                        'permiso para dar de alta pacientes.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN
            )

        serializer = PacienteSerializer(
            data=request.data,
            context={
                'request': request
            }
        )

        if not serializer.is_valid():
            return Response(
                serializer.errors,
                status=status.HTTP_400_BAD_REQUEST
            )

        paciente = serializer.save()

        return Response(
            PacienteSerializer(paciente).data,
            status=status.HTTP_201_CREATED
        )


class PacienteEstadoView(APIView):

    permission_classes = [IsAuthenticated]

    def patch(self, request, paciente_id):

        usuario = request.user

        if not usuario.rol:
            return Response(
                {
                    'detail': (
                        'El usuario no tiene un rol asignado.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN
            )

        nombre_rol = usuario.rol.rol
        nuevo_estado = request.data.get('estado')

        if not nuevo_estado:
            return Response(
                {
                    'detail': (
                        'Debés indicar el estado del paciente.'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        if nuevo_estado not in (
            EstadoEntidadService.ESTADO_ACTIVO,
            EstadoEntidadService.ESTADO_INACTIVO
        ):
            return Response(
                {
                    'detail': (
                        'El estado debe ser Activo o Inactivo.'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        if nombre_rol == 'Administrador':
            return Response(
                {
                    'detail': (
                        'No tenés permiso para cambiar '
                        'el estado de los pacientes.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN
            )

        profesional = None

        if nombre_rol == 'Profesional':

            try:
                profesional = Profesional.objects.select_related(
                    'estado_profesional'
                ).get(usuario=usuario)

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

            if profesional.estado_profesional.estado != 'Activo':
                return Response(
                    {
                        'detail': (
                            'Tu cuenta profesional está inactiva. '
                            'No tenés autorización para cambiar '
                            'el estado de los pacientes.'
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN
                )

            if nuevo_estado == EstadoEntidadService.ESTADO_INACTIVO:

                asignacion_activa = (
                    AsignacionProfesional.objects.filter(
                        profesional=profesional,
                        paciente_id=paciente_id,
                        fecha_fin__isnull=True
                    ).exists()
                )

                if not asignacion_activa:
                    return Response(
                        {
                            'detail': (
                                'Solo podés dar de baja pacientes '
                                'que estén asignados a vos.'
                            )
                        },
                        status=status.HTTP_403_FORBIDDEN
                    )

        elif nombre_rol == 'SuperAdministrador':

            # Se conserva el comportamiento anterior para la baja.
            # La reactivación siempre requiere un Profesional activo.
            if nuevo_estado == EstadoEntidadService.ESTADO_ACTIVO:
                return Response(
                    {
                        'detail': (
                            'La reactivación del paciente debe '
                            'realizarla un Profesional activo.'
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN
                )

        else:
            return Response(
                {
                    'detail': (
                        'El rol del usuario no tiene permiso '
                        'para cambiar el estado de los pacientes.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN
            )

        paciente = EstadoEntidadService.cambiar_estado_paciente(
            id_paciente=paciente_id,
            nuevo_estado=nuevo_estado,
            profesional=profesional
        )

        return Response(
            PacienteSerializer(paciente).data,
            status=status.HTTP_200_OK
        )