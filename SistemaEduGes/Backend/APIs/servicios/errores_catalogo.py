"""Errores del servidor que no deben atribuirse a la entrada del usuario."""
from rest_framework.exceptions import APIException


class CatalogoNoDisponible(APIException):
    status_code = 503

    def __init__(self, detail, codigo='catalogo_incompleto'):
        super().__init__({'codigo': codigo, 'detail': detail})
