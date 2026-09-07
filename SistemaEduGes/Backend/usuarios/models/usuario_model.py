from django.db import models


class Usuario(models.Model):
    id_usuario = models.AutoField(
        primary_key=True,
        db_column='ID_Usuario'
    )

    usuario = models.CharField(
        max_length=100,
        unique=True,
        db_column='Usuario'
    )

    rol = models.ForeignKey(
        'Rol',
        on_delete=models.PROTECT,
        db_column='ID_Rol',
        null=True,
        blank=True
    )

    password = models.CharField(
        max_length=250,
        db_column='Password'
    )

    class Meta:
        managed = False
        db_table = 'usuarios'