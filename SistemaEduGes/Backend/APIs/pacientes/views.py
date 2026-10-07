from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pacientes.models.paciente_model import Paciente
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import (
    AsignacionProfesional
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

        if nombre_rol == 'Profesional':

            try:

                profesional = Profesional.objects.get(
                    usuario=usuario
                )

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

            pacientes = Paciente.objects.filter(
                id_paciente__in=AsignacionProfesional.objects.filter(
                    profesional=profesional,
                    fecha_fin__isnull=True
                ).values('paciente_id')
            ).order_by(
                'apellido',
                'nombre'
            )

        elif nombre_rol == 'Administrador':

            pacientes = Paciente.objects.all().order_by(
                'apellido',
                'nombre'
            )

        elif nombre_rol == 'SuperAdministrador':

            pacientes = Paciente.objects.all().order_by(
                'apellido',
                'nombre'
            )

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

        serializer = PacienteSerializer(
            pacientes,
            many=True
        )

        return Response(
            serializer.data,
            status=status.HTTP_200_OK
        )

    def post(self, request):

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