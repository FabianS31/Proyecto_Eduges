
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache

from APIs.autenticacion.autenticacion import (
    UsuarioSessionAuthentication,
)
from APIs.sesiones.serializers.sesiones_serializers import (
    RegistroSesionEntradaSerializer,
    RegistroSesionEdicionSerializer,
    RegistroSesionProfesionalSerializer,
    RegistroSesionResumenSerializer,
    TurnosPendientesFiltroSerializer,
    HistorialSesionFiltroSerializer,
)
from APIs.sesiones.services.sesiones_services import (
    SesionesService,
)


class TurnosPendientesSesionView(APIView):

    authentication_classes = [UsuarioSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Los filtros vacíos siguen siendo equivalentes a omitirlos.
        filtros = TurnosPendientesFiltroSerializer(data={
            campo: request.query_params[campo]
            for campo in ('fecha_desde', 'fecha_hasta', 'paciente_id')
            if campo in request.query_params
            and request.query_params[campo] != ''
        })
        filtros.is_valid(raise_exception=True)

        turnos = SesionesService.listar_turnos_pendientes(
            usuario=request.user,
            **filtros.validated_data,
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


@method_decorator(never_cache, name='dispatch')
class RegistroSesionCrearView(APIView):

    authentication_classes = [UsuarioSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        filtros = HistorialSesionFiltroSerializer(data=request.query_params)
        filtros.is_valid(raise_exception=True)
        turnos = SesionesService.listar_historial(
            usuario=request.user, **filtros.validated_data,
        )
        return Response([
            {
                'turno_id': turno.pk,
                'fecha': turno.fecha,
                'hora': turno.hora,
                'profesional': {
                    'id': turno.profesional_id,
                    'nombre': turno.profesional.nombre,
                    'apellido': turno.profesional.apellido,
                },
                'sesion': RegistroSesionResumenSerializer(turno.registro_sesion).data,
            }
            for turno in turnos
        ])

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
            diagnostico=datos['diagnostico'],
            nota_sesion=datos.get('nota_sesion'),
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
                'diagnostico': registro.diagnostico,
                'nota_sesion': registro.nota_sesion,
                'mensaje': 'Registro de sesión creado correctamente.',
            },
            status=status.HTTP_201_CREATED,
        )


@method_decorator(never_cache, name='dispatch')
class RegistroSesionDetalleView(APIView):

    authentication_classes = [UsuarioSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, turno_id):
        registro, acceso_completo = SesionesService.obtener_sesion(
            turno_id=turno_id,
            usuario=request.user,
        )

        if acceso_completo:
            serializer = RegistroSesionProfesionalSerializer(registro)
        else:
            serializer = RegistroSesionResumenSerializer(registro)

        return Response(serializer.data)

    def patch(self, request, turno_id):
        entrada = RegistroSesionEdicionSerializer(data=request.data, partial=True)
        entrada.is_valid(raise_exception=True)
        registro = SesionesService.modificar_sesion(
            turno_id=turno_id,
            datos=entrada.validated_data,
            usuario=request.user,
        )

        serializer = RegistroSesionProfesionalSerializer(registro)

        return Response(serializer.data)
