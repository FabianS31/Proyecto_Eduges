from django.db import models


class EstadoProfesional(models.Model):
    id_estado_profesional = models.AutoField(
        primary_key=True,
        db_column='ID_EstadoProfesional'
    )

    estado = models.CharField(
        max_length=100,
        db_column='Estado'
    )

    class Meta:
        managed = False
        db_table = 'estados_profesionales'