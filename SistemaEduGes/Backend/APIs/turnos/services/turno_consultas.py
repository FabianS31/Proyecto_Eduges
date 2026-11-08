from datetime import datetime, timedelta

from turnos.models import Turno


class ConsultasTurnoMixin:
    @classmethod
    def obtener_conflictos_horario(cls, turno):
        """
        Devuelve los turnos Pendientes o Confirmados del mismo
        profesional que se superponen con el turno recibido.

        La detección es dinámica: no guarda marcas en la base.
        """

        inicio = datetime.combine(
            turno.fecha,
            turno.hora.replace(tzinfo=None),
        )

        fin = inicio + timedelta(
            minutes=cls.DURACION_MINUTOS
        )

        turnos_existentes = (
            Turno.objects
            .filter(
                profesional_id=turno.profesional_id,
                fecha=turno.fecha,
                estado__estado__in=cls.ESTADOS_EDITABLES,
            )
            .exclude(pk=turno.pk)
            .select_related(
                'estado',
                'paciente',
            )
        )

        conflictos = []

        for existente in turnos_existentes:
            inicio_existente = datetime.combine(
                existente.fecha,
                existente.hora.replace(tzinfo=None),
            )

            fin_existente = inicio_existente + timedelta(
                minutes=cls.DURACION_MINUTOS
            )

            if (
                inicio < fin_existente
                and inicio_existente < fin
            ):
                conflictos.append({
                    'id_turno': existente.id_turno,
                    'fecha': existente.fecha,
                    'hora': existente.hora,
                    'estado': existente.estado.estado,
                })

        return conflictos

    @classmethod
    def tiene_conflicto_horario(cls, turno):
        return bool(cls.obtener_conflictos_horario(turno))

    @staticmethod
    def obtener_turnos_reasignados(turnos_ids):
        return (
            Turno.objects
            .filter(pk__in=turnos_ids)
            .select_related(
                'estado',
                'profesional',
                'paciente',
            )
            .order_by('fecha', 'hora')
        )