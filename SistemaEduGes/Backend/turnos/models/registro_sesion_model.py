from django.db import models


class RegistroSesion(models.Model):

    id_registro_sesion = models.AutoField(
        primary_key=True,
        db_column='ID_RegistroSesion'
    )

    nota_clinica = models.CharField(
        max_length=5000,
        db_column='NotaClinica'
    )

    class Meta:
        managed = False
        db_table = 'registros_de_sesiones'