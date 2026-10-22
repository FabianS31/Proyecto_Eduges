from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView


class ReporteBaseView(APIView):
    """
    Base común para los reportes de EduGes.

    Administrador y SuperAdministrador pueden consultar todos
    los reportes.

    Profesional solamente puede consultar el reporte de turnos.
    La limitación a sus propios pacientes se aplica en el servicio.
    """

    permission_classes = [IsAuthenticated]

    roles_administrativos = (
        'Administrador',
        'SuperAdministrador',
    )

    def obtener_nombre_rol(self, request):
        usuario = request.user
        rol = getattr(usuario, 'rol', None)
        return getattr(rol, 'rol', None)

    def verificar_acceso(self, request, permitir_profesional=False):
        nombre_rol = self.obtener_nombre_rol(request)

        roles_autorizados = list(self.roles_administrativos)

        if permitir_profesional:
            roles_autorizados.append('Profesional')

        if nombre_rol not in roles_autorizados:
            return Response(
                {
                    'detail': (
                        'No tenés permiso para consultar '
                        'este reporte de EduGes.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        return None


class ReporteTurnosView(ReporteBaseView):
    """Genera reportes de turnos."""

    def get(self, request):
        respuesta_acceso = self.verificar_acceso(
            request,
            permitir_profesional=True,
        )

        if respuesta_acceso is not None:
            return respuesta_acceso

        from APIs.reportes.serializers.reporte_serializer import (
            ReporteTurnosFiltroSerializer,
        )
        from APIs.reportes.services.reporte_service import (
            ReportesService,
        )

        filtros = ReporteTurnosFiltroSerializer(
            data=request.query_params,
        )
        filtros.is_valid(raise_exception=True)

        resultado = ReportesService.obtener_turnos(
            filtros=filtros.validated_data,
            usuario=request.user,
        )

        return Response(
            resultado,
            status=status.HTTP_200_OK,
        )


class ReporteAlumnosView(ReporteBaseView):
    """Genera reportes de pacientes."""

    def get(self, request):
        respuesta_acceso = self.verificar_acceso(request)

        if respuesta_acceso is not None:
            return respuesta_acceso

        from APIs.reportes.serializers.reporte_serializer import (
            ReporteAlumnosFiltroSerializer,
        )
        from APIs.reportes.services.reporte_service import (
            ReportesService,
        )

        filtros = ReporteAlumnosFiltroSerializer(
            data=request.query_params,
        )
        filtros.is_valid(raise_exception=True)

        resultado = ReportesService.obtener_alumnos(
            filtros=filtros.validated_data,
        )

        return Response(
            resultado,
            status=status.HTTP_200_OK,
        )


class ReporteProfesionalesView(ReporteBaseView):
    """Genera reportes de profesionales."""

    def get(self, request):
        respuesta_acceso = self.verificar_acceso(request)

        if respuesta_acceso is not None:
            return respuesta_acceso

        from APIs.reportes.serializers.reporte_serializer import (
            ReporteProfesionalesFiltroSerializer,
        )
        from APIs.reportes.services.reporte_service import (
            ReportesService,
        )

        filtros = ReporteProfesionalesFiltroSerializer(
            data=request.query_params,
        )
        filtros.is_valid(raise_exception=True)

        resultado = ReportesService.obtener_profesionales(
            filtros=filtros.validated_data,
        )

        return Response(
            resultado,
            status=status.HTTP_200_OK,
        )