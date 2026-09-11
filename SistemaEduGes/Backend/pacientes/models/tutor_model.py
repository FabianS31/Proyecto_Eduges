from django.db import models


class Parentesco(models.Model):
    id_parentesco = models.AutoField(
        primary_key=True,
        db_column='ID_Parentesco'
    )

    descripcion = models.CharField(
        max_length=100,
        db_column='Descripcion'
    )

    class Meta:
        managed = False
        db_table = 'parentescos'


class Tutor(models.Model):
    id_tutor = models.AutoField(
        primary_key=True,
        db_column='ID_Tutor'
    )

    nombre = models.CharField(
        max_length=100,
        db_column='Nombre'
    )

    apellido = models.CharField(
        max_length=100,
        db_column='Apellido'
    )

    telefono_fijo = models.CharField(
        max_length=30,
        db_column='TelefonoFijo'
    )

    telefono_movil = models.CharField(
        max_length=30,
        db_column='TelefonoMovil'
    )

    mail = models.CharField(
        max_length=150,
        db_column='Mail'
    )

    class Meta:
        managed = False
        db_table = 'tutores'


class PacienteTutor(models.Model):
    id_paciente_tutor = models.AutoField(
        primary_key=True,
        db_column='ID_PacienteTutor'
    )

    tutor = models.ForeignKey(
        Tutor,
        on_delete=models.CASCADE,
        db_column='ID_Tutor'
    )

    paciente = models.ForeignKey(
        'Paciente',
        on_delete=models.CASCADE,
        db_column='ID_Paciente'
    )

    parentesco = models.ForeignKey(
        Parentesco,
        on_delete=models.PROTECT,
        db_column='ID_Parentesco'
    )

    responsable_principal = models.BooleanField(
        db_column='ResponsablePrincipal'
    )

    class Meta:
        managed = False
        db_table = 'pacientes_tutores'