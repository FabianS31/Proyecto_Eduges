from django.db import models
from .estados_profesionales_model import EstadoProfesional


class Especialidad(models.Model):
    id_especialidad = models.AutoField(
        primary_key=True,
        db_column='ID_Especialidad'
    )

    especialidad = models.CharField(
        max_length=100,
        db_column='Especialidad'
    )

    class Meta:
        managed = False
        db_table = 'especialidades'


class Profesional(models.Model):
    id_profesional = models.AutoField(
        primary_key=True,
        db_column='ID_Profesionales'
    )

    nombre = models.CharField(
        max_length=100,
        db_column='Nombre'
    )

    apellido = models.CharField(
        max_length=100,
        db_column='Apellido'
    )

    dni = models.CharField(
        max_length=20,
        db_column='DNI'
    )

    matricula = models.CharField(
        max_length=50,
        db_column='Matricula'
    )

    especialidad = models.ForeignKey(
        Especialidad,
        on_delete=models.PROTECT,
        db_column='ID_Especialidad'
    )

    contacto = models.CharField(
        max_length=50,
        db_column='Contacto',
        null=True,
        blank=True
    )

    mail = models.CharField(
        max_length=50,
        db_column='Mail',
        null=True,
        blank=True
    )

    usuario = models.OneToOneField(
        'usuarios.Usuario',
        on_delete=models.PROTECT,
        db_column='ID_Usuario'
    )

    estado_profesional = models.ForeignKey(
        EstadoProfesional,
        on_delete=models.PROTECT,
        db_column='ID_EstadoProfesional'
    )

    class Meta:
        managed = False
        db_table = 'profesionales'