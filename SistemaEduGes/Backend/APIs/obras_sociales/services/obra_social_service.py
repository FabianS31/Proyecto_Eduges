
import unicodedata
from contextlib import contextmanager
from django.db import connection, transaction

from pacientes.models.obra_social_model import ObraSocial


class ObraSocialService:

    @staticmethod
    @contextmanager
    def escritura_serializada():
        # Clave estable y común a POST/PATCH, también entre procesos/conexiones.
        # PostgreSQL libera el bloqueo al terminar o revertir la transacción.
        with transaction.atomic():
            if connection.vendor == 'postgresql':
                with connection.cursor() as cursor:
                    cursor.execute('SELECT pg_advisory_xact_lock(%s, %s)', [1162106183, 5])
            yield

    @staticmethod
    def normalizar_nombre(nombre):
        nombre = unicodedata.normalize('NFD', nombre.strip())

        nombre = ''.join(
            caracter
            for caracter in nombre
            if unicodedata.category(caracter) != 'Mn'
        )

        return nombre.casefold()

    @classmethod
    def nombre_duplicado(cls, *, nombre, excluir_id=None):
        consulta = ObraSocial.objects.all()

        if excluir_id is not None:
            consulta = consulta.exclude(
                pk=excluir_id
            )

        nombre_normalizado = cls.normalizar_nombre(nombre)

        return any(
            cls.normalizar_nombre(obra_social.nombre)
            == nombre_normalizado
            for obra_social in consulta.only(
                'id_obra_social',
                'nombre'
            )
        )

    @staticmethod
    def listar(*, estado_id=None):
        consulta = (
            ObraSocial.objects
            .select_related(
                'tipo',
                'estado',
            )
            .order_by('nombre')
        )

        if estado_id is not None:
            consulta = consulta.filter(
                estado_id=estado_id
            )

        return consulta

    @staticmethod
    def obtener(*, obra_social_id):
        return (
            ObraSocial.objects
            .select_related(
                'tipo',
                'estado',
            )
            .filter(
                pk=obra_social_id
            )
            .first()
        )
