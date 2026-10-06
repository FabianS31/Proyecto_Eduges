from django.db import models


class PacienteTutor(models.Model):
    id_paciente_tutor = models.AutoField(
        primary_key=True,
        db_column='ID_PacienteTutor'
    )

    tutor = models.ForeignKey(
        'Tutor',
        on_delete=models.CASCADE,
        db_column='ID_Tutor'
    )

    paciente = models.ForeignKey(
        'Paciente',
        on_delete=models.CASCADE,
        db_column='ID_Paciente'
    )

    parentesco = models.ForeignKey(
        'Parentesco',
        on_delete=models.PROTECT,
        db_column='ID_Parentesco'
    )

    responsable_principal = models.BooleanField(
        db_column='ResponsablePrincipal'
    )

    class Meta:
        managed = False
        db_table = 'pacientes_tutores'
        constraints = [
            models.UniqueConstraint(
                fields=['paciente', 'tutor'],
                name='uq_paciente_tutor'
            )
        ]