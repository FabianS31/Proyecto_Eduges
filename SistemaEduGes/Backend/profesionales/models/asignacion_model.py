from django.db import models


class AsignacionProfesional(models.Model):
    id_asignacion_profesional = models.AutoField(
        primary_key=True,
        db_column='ID_AsignacionProfesional'
    )

    paciente = models.ForeignKey(
        'pacientes.Paciente',
        on_delete=models.CASCADE,
        db_column='ID_Paciente'
    )

    profesional = models.ForeignKey(
        'Profesional',
        on_delete=models.CASCADE,
        db_column='ID_Profesional'
    )

    fecha_inicio = models.DateField(
        db_column='FechaInicio'
    )

    fecha_fin = models.DateField(
        null=True,
        blank=True,
        db_column='FechaFin'
    )

    class Meta:
        managed = False
        db_table = 'asignaciones_profesionales'