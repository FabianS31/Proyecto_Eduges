
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from APIs.autenticacion.autenticacion import (
    UsuarioSessionAuthentication,
)
from APIs.sesiones.serializers.sesiones_serializers import (
    RegistroSesionEntradaSerializer,
    RegistroSesionProfesionalSerializer,
    RegistroSesionResumenSerializer,
)
from APIs.sesiones.services.sesiones_services import (
    SesionesService,
)


class TurnosPendientesSesionView(APIView):
    authentication_classes = [UsuarioSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        fecha_desde = request.query_params.get('fecha_desde')
        fecha_hasta = request.query_params.get('fecha_hasta')
        paciente_id = request.query_params.get('paciente_id')

        turnos = SesionesService.listar_turnos_pendientes(
            usuario=request.user,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            paciente_id=paciente_id,
        )

        datos = [
            {
                'id': turno.pk,
                'fecha': turno.fecha,
                'hora': turno.hora,
                'paciente': {
                    'id': turno.paciente.pk,
                    'nombre': turno.paciente.nombre,
                    'apellido': turno.paciente.apellido,
                },
                'estado': {
                    'id': turno.estado.pk,
                    'nombre': turno.estado.estado,
                },
            }
            for turno in turnos
        ]

        return Response(datos)


class RegistroSesionCrearView(APIView):
    """
    Crea un registro para un turno que todavía no tenga uno.
    """

    authentication_classes = [UsuarioSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = RegistroSesionEntradaSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        datos = serializer.validated_data
        turno = datos.pop('turno')

        registro = SesionesService.registrar_sesion(
            turno_id=turno.pk,
            trabajo_sesion=datos['trabajo_sesion'],
            resultado=datos['resultado'],
            nota_especial=datos.get('nota_especial'),
            usuario=request.user,
        )

        return Response(
            {
                'id': registro.pk,
                'descripcion': (
                    f'Registro clínico correspondiente al turno '
                    f'{turno.pk}'
                ),
                'trabajo_sesion': registro.trabajo_sesion,
                'mensaje': 'Registro de sesión creado correctamente.',
            },
            status=status.HTTP_201_CREATED,
        )


class RegistroSesionDetalleView(APIView):
    """
    Consulta y modifica registros de sesión según el rol.
    """

    authentication_classes = [UsuarioSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, turno_id):
        registro = SesionesService.obtener_sesion(
            turno_id=turno_id,
            usuario=request.user,
        )

        rol = SesionesService.obtener_rol(request.user)

        if rol == 'Administrador':
            serializer = RegistroSesionResumenSerializer(registro)
        else:
            serializer = RegistroSesionProfesionalSerializer(registro)

        return Response(serializer.data)

    def patch(self, request, turno_id):
        registro = SesionesService.modificar_sesion(
            turno_id=turno_id,
            datos=request.data,
            usuario=request.user,
        )

        serializer = RegistroSesionProfesionalSerializer(registro)

        return Response(serializer.data)