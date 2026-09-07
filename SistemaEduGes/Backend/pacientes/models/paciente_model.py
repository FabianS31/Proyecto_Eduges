from django.db import models


class EstadoPaciente(models.Model):
    id_estado_paciente = models.AutoField(
        primary_key=True,
        db_column='ID_EstadoPaciente'
    )

    estado = models.CharField(
        max_length=50,
        db_column='Estado'
    )

    class Meta:
        managed = False
        db_table = 'estados_pacientes'


class Paciente(models.Model):
    id_paciente = models.AutoField(
        primary_key=True,
        db_column='ID_Paciente'
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

    fecha_nacimiento = models.DateField(
        db_column='FechaNacimiento'
    )

    direccion = models.CharField(
        max_length=255,
        db_column='Direccion'
    )

    consentimiento = models.BooleanField(
        db_column='Consentimiento'
    )

    cud_vencimiento = models.DateField(
        db_column='CUD_Vencimiento'
    )

    obra_social = models.ForeignKey(
        'ObraSocial',
        on_delete=models.PROTECT,
        db_column='ID_ObraSocial'
    )

    numero_afiliado = models.CharField(
        max_length=20,
        db_column='NumeroAfiliado'
    )

    estado = models.ForeignKey(
        EstadoPaciente,
        on_delete=models.PROTECT,
        db_column='ID_EstadoPaciente'
    )

    class Meta:
        managed = False
        db_table = 'pacientes'