from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from turnos.models import Turno
from APIs.turnos.serializers.turno_serializer import TurnoSerializer


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
        ).order_by(
            'fecha',
            'hora',
        )

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
                profesional=profesional
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

        serializer.is_valid(raise_exception=True)
        turno = serializer.save()

        return Response(
            {
                'id_turno': turno.id_turno,
                'fecha': turno.fecha,
                'hora': turno.hora,
                'paciente': turno.paciente_id,
                'profesional': turno.profesional_id,
                'estado': turno.estado.estado,
            },
            status=status.HTTP_201_CREATED,
        )