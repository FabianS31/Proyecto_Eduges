from django.db import models


class EstadoObraSocial(models.Model):
    id_estado_obra_social = models.AutoField(
        primary_key=True,
        db_column='ID_EstadoObraSocial'
    )

    descripcion = models.CharField(
        max_length=100,
        db_column='Descripcion'
    )

    class Meta:
        managed = False
        db_table = 'estados_obras_sociales'


class TipoObraSocial(models.Model):
    id_tipo_os = models.AutoField(
        primary_key=True,
        db_column='ID_TipoOS'
    )

    tipo = models.CharField(
        max_length=100,
        db_column='Tipo'
    )

    class Meta:
        managed = False
        db_table = 'tipos_obras_sociales'


class ObraSocial(models.Model):
    id_obra_social = models.AutoField(
        primary_key=True,
        db_column='ID_ObraSocial'
    )

    nombre = models.CharField(
        max_length=150,
        db_column='Nombre'
    )

    contacto = models.CharField(
        max_length=150,
        db_column='Contacto',
        null=True,
        blank=True
    )

    mail = models.CharField(
        max_length=150,
        db_column='Mail',
        null=True,
        blank=True
    )

    web = models.CharField(
        max_length=255,
        db_column='Web',
        null=True,
        blank=True
    )

    estado = models.ForeignKey(
        EstadoObraSocial,
        on_delete=models.PROTECT,
        db_column='ID_EstadoObraSocial'
    )

    tipo = models.ForeignKey(
        TipoObraSocial,
        on_delete=models.PROTECT,
        db_column='ID_TipoOS'
    )

    class Meta:
        managed = False
        db_table = 'obras_sociales'