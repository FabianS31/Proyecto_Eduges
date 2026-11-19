"""Traducción acotada a las unicidades declaradas por cada operación."""
from contextlib import contextmanager

from django.db import IntegrityError, connection, transaction
from rest_framework.exceptions import ValidationError


def campo_duplicado(error, campos):
    causa = error.__cause__
    if connection.vendor == 'postgresql':
        if getattr(causa, 'sqlstate', getattr(causa, 'pgcode', None)) != '23505':
            return None
        diag = getattr(causa, 'diag', None)
        tabla = getattr(diag, 'table_name', None)
        restriccion = getattr(diag, 'constraint_name', None)
        if not tabla or not restriccion:
            return None
        candidatos = [c for c in campos if c[0]._meta.db_table == tabla]
        if not candidatos:
            return None
        # Consultar después del rollback del savepoint, nunca en una transacción rota.
        # No depender del nombre generado por Django o asignado por Supabase.
        with connection.cursor() as cursor:
            restricciones = connection.introspection.get_constraints(cursor, tabla)
        detalle = restricciones.get(restriccion, {})
        if not detalle.get('unique') or detalle.get('primary_key'):
            return None
        for modelo, atributo, campo, mensaje in candidatos:
            if detalle.get('columns') == [modelo._meta.get_field(atributo).column]:
                return campo, mensaje
    elif connection.vendor == 'sqlite':
        # Solo para el entorno aislado: distinguir UNIQUE de FK/NOT NULL/CHECK.
        if getattr(causa, 'sqlite_errorcode', None) != 2067:
            return None
        for modelo, atributo, campo, mensaje in campos:
            columna = modelo._meta.get_field(atributo).column
            if str(causa) == f'UNIQUE constraint failed: {modelo._meta.db_table}.{columna}':
                return campo, mensaje
    return None


@contextmanager
def guardar_con_unicidad(campos):
    try:
        with transaction.atomic():
            yield
    except IntegrityError as error:
        duplicado = campo_duplicado(error, campos)
        if duplicado is None:
            raise
        campo, mensaje = duplicado
        raise ValidationError({campo: mensaje}) from error
