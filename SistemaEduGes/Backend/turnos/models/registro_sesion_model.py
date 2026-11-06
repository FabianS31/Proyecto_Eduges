
from django.db import models


class RegistroSesion(models.Model):

    id_registro_sesion = models.AutoField(
        primary_key=True,
        db_column='ID_RegistroSesion'
    )

    trabajo_sesion = models.TextField(
        db_column='TrabajoSesion'
    )

    diagnostico = models.TextField(
        db_column='Diagnostico'
    )

    nota_sesion = models.TextField(
        db_column='NotaSesion',
        null=True,
        blank=True
    )

    class Meta:
        managed = False
        db_table = 'registros_de_sesiones'