from django.db import models


class RegistroSesion(models.Model):

    id_registro_sesion = models.AutoField(
        primary_key=True,
        db_column='ID_RegistroSesion'
    )

    trabajo_sesion = models.CharField(
        max_length=225,
        db_column='TrabajoSesion'
    )

    resultado = models.CharField(
        max_length=225,
        db_column='Resultado'
    )

    nota_especial = models.CharField(
        max_length=225,
        db_column='NotaEspecial'
    )

    class Meta:
        managed = False
        db_table = 'registros_de_sesiones'