from django.db import models


class EstadoTurno(models.Model):
    id_estado_turno = models.AutoField(
        primary_key=True,
        db_column='ID_EstadoTurno'
    )

    estado = models.CharField(
        max_length=50,
        db_column='Estado'
    )

    class Meta:
        managed = False
        db_table = 'estados_turnos'


class Turno(models.Model):
    id_turno = models.AutoField(
        primary_key=True,
        db_column='ID_Turnos'
    )

    fecha = models.DateField(
        db_column='Fecha'
    )

    hora = models.TimeField(
        db_column='Hora'
    )

    estado = models.ForeignKey(
        EstadoTurno,
        on_delete=models.PROTECT,
        db_column='ID_EstadoTurno'
    )

    registro_sesion = models.ForeignKey(
        'RegistroSesion',
        on_delete=models.SET_NULL,
        db_column='ID_RegistroSesion',
        null=True,
        blank=True
    )

    profesional = models.ForeignKey(
        'profesionales.Profesional',
        on_delete=models.PROTECT,
        db_column='ID_Profesional'
    )

    paciente = models.ForeignKey(
        'pacientes.Paciente',
        on_delete=models.PROTECT,
        db_column='ID_Paciente'
    )

    class Meta:
        managed = False
        db_table = 'turnos'