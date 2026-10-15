
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import NotFound

from turnos.models import Turno
from APIs.turnos.serializers.turno_serializer import (
    TurnoSerializer,
)
from APIs.turnos.services.turno_service import TurnoService


class TurnoListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        usuario = request.user
        nombre_rol = getattr(
            getattr(usuario, 'rol', None),
            'rol',
            None,
        )

        turnos = Turno.objects.select_related(
            'estado',
            'profesional',
            'paciente',
        ).order_by('fecha', 'hora')

        if nombre_rol == 'Profesional':
            try:
                profesional = usuario.profesional
            except Exception:
                return Response(
                    {
                        'detail': (
                            'El usuario no está vinculado '
                            'a un profesional.'
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            turnos = turnos.filter(
                profesional=profesional,
            )

        elif nombre_rol not in (
            'Administrador',
            'SuperAdministrador',
        ):
            return Response(
                {
                    'detail': (
                        'No tenés permiso para consultar turnos.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = TurnoSerializer(
            turnos,
            many=True,
        )

        return Response(serializer.data)

    def post(self, request):
        serializer = TurnoSerializer(
            data=request.data,
            context={'request': request},
        )

        serializer.is_valid(
            raise_exception=True,
        )

        resultado = serializer.save()

        if isinstance(resultado, list):
            respuesta = [
                TurnoSerializer(turno).data
                for turno in resultado
            ]

            return Response(
                {
                    'cantidad': len(respuesta),
                    'turnos': respuesta,
                },
                status=status.HTTP_201_CREATED,
            )

        return Response(
            TurnoSerializer(resultado).data,
            status=status.HTTP_201_CREATED,
        )


class TurnoDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def obtener_turno(self, turno_id):
        try:
            return Turno.objects.select_related(
                'estado',
                'profesional',
                'profesional__estado_profesional',
                'paciente',
                'paciente__estado',
            ).get(pk=turno_id)

        except Turno.DoesNotExist:
            raise NotFound(
                'El turno solicitado no existe.'
            )

    def put(self, request, turno_id):
        turno = self.obtener_turno(turno_id)

        serializer = TurnoSerializer(
            turno,
            data=request.data,
            context={'request': request},
        )

        serializer.is_valid(
            raise_exception=True,
        )

        resultado = serializer.save()

        return Response(
            TurnoSerializer(resultado).data,
            status=status.HTTP_200_OK,
        )

    def patch(self, request, turno_id):
        turno = self.obtener_turno(turno_id)

        serializer = TurnoSerializer(
            turno,
            data=request.data,
            partial=True,
            context={'request': request},
        )

        serializer.is_valid(
            raise_exception=True,
        )

        resultado = serializer.save()

        return Response(
            TurnoSerializer(resultado).data,
            status=status.HTTP_200_OK,
        )

    def delete(self, request, turno_id):
        resultado = TurnoService.cancelar_turno(
            turno_id=turno_id,
            usuario=request.user,
        )

        return Response(
            TurnoSerializer(resultado).data,
            status=status.HTTP_200_OK,
        )


class TurnoEstadoView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, turno_id):
        estado_id = request.data.get(
            'ID_EstadoTurno',
        )

        if estado_id is None:
            return Response(
                {
                    'ID_EstadoTurno': (
                        'Este campo es obligatorio.'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            estado_id = int(estado_id)

        except (TypeError, ValueError):
            return Response(
                {
                    'ID_EstadoTurno': (
                        'Debe ser un identificador numérico.'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        resultado = TurnoService.cambiar_estado_turno(
            turno_id=turno_id,
            estado_id=estado_id,
            usuario=request.user,
        )

        return Response(
            TurnoSerializer(resultado).data,
            status=status.HTTP_200_OK,
        )