from django.db import models


class RegistroSesion(models.Model):

    id_registro_sesion = models.AutoField(
        primary_key=True,
        db_column='ID_RegistroSesion'
    )

    trabajo_sesion = models.CharField(
        max_length=225,
        db_column='TrabajoSesion',
        null=True,
        blank=True
    )

    resultado_respuesta = models.CharField(
        max_length=225,
        db_column='Resultado/Respuesta',
        null=True,
        blank=True
    )

    nota_especial = models.CharField(
        max_length=225,
        db_column='NotaEspecial',
        null=True,
        blank=True
    )

    class Meta:
        managed = False
        db_table = 'registros_de_sesiones'