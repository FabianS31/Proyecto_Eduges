from django.db import transaction
from rest_framework.exceptions import ValidationError

from pacientes.models import Tutor, PacienteTutor


class TutorService:

    @staticmethod
    @transaction.atomic
    def crear_tutor(datos_tutor, datos_relacion):
        """
        Crea un tutor y su relación inicial en una transacción.
        """

        tutor = Tutor.objects.create(**datos_tutor)

        TutorService.crear_relacion(
            tutor=tutor,
            datos_relacion=datos_relacion,
        )

        return tutor

    @staticmethod
    @transaction.atomic
    def actualizar_tutor(tutor, datos):
        """
        Actualiza solamente los campos recibidos.
        """

        for campo, valor in datos.items():
            setattr(tutor, campo, valor)

        if datos:
            tutor.save(update_fields=list(datos.keys()))

        return tutor

    @staticmethod
    @transaction.atomic
    def crear_relacion(tutor, datos_relacion):
        """
        Crea o reactiva la relación entre un tutor y un paciente.
        Nunca crea una segunda fila para la misma pareja.
        """

        paciente = datos_relacion['paciente']
        parentesco = datos_relacion['parentesco']
        responsable_principal = datos_relacion.get(
            'responsable_principal',
            False,
        )

        relacion = PacienteTutor.objects.filter(
            tutor=tutor,
            paciente=paciente,
        ).first()

        if relacion and relacion.activo:
            raise ValidationError({
                'paciente_id': (
                    'Este tutor ya tiene una relación activa '
                    'con el paciente indicado.'
                )
            })

        if responsable_principal:
            existe_responsable = PacienteTutor.objects.filter(
                paciente=paciente,
                activo=True,
                responsable_principal=True,
            ).exists()

            if existe_responsable:
                raise ValidationError({
                    'responsable_principal': (
                        'El paciente ya tiene un tutor '
                        'responsable principal activo.'
                    )
                })

        if relacion:
            relacion.parentesco = parentesco
            relacion.responsable_principal = responsable_principal
            relacion.activo = True

            relacion.save(update_fields=[
                'parentesco',
                'responsable_principal',
                'activo',
            ])

            return relacion

        return PacienteTutor.objects.create(
            tutor=tutor,
            paciente=paciente,
            parentesco=parentesco,
            responsable_principal=responsable_principal,
            activo=True,
        )

    @staticmethod
    @transaction.atomic
    def actualizar_relacion(relacion, datos):
        """
        Actualiza una relación activa o reactiva una inactiva
        cuando se solicita explícitamente activo=True.
        """

        activo_solicitado = datos.get('activo', relacion.activo)

        # Una relación inactiva solo puede modificarse si se
        # solicita expresamente su reactivación.
        if not relacion.activo and activo_solicitado is not True:
            raise ValidationError(
                'La relación está inactiva. Para modificarla, '
                'primero debe reactivarse con activo=True.'
            )

        # La baja se realiza mediante DELETE, no mediante PATCH.
        if relacion.activo and activo_solicitado is False:
            raise ValidationError({
                'activo': (
                    'Para dar de baja una relación, utilizá '
                    'el método DELETE.'
                )
            })

        paciente = datos.get('paciente', relacion.paciente)
        parentesco = datos.get('parentesco', relacion.parentesco)
        responsable_principal = datos.get(
            'responsable_principal',
            relacion.responsable_principal,
        )

        if paciente.pk != relacion.paciente_id:
            raise ValidationError({
                'paciente_id': (
                    'No se puede cambiar el paciente de una '
                    'relación existente.'
                )
            })

        # No permite que el paciente tenga dos responsables
        # principales activos.
        if activo_solicitado and responsable_principal:
            otros_responsables = PacienteTutor.objects.filter(
                paciente=paciente,
                activo=True,
                responsable_principal=True,
            ).exclude(
                pk=relacion.pk
            )

            if otros_responsables.exists():
                raise ValidationError({
                    'responsable_principal': (
                        'El paciente ya tiene otro tutor '
                        'responsable principal activo.'
                    )
                })

        relacion.parentesco = parentesco
        relacion.responsable_principal = responsable_principal
        relacion.activo = activo_solicitado

        relacion.save(update_fields=[
            'parentesco',
            'responsable_principal',
            'activo',
        ])

        return relacion

    @staticmethod
    @transaction.atomic
    def dar_baja_relacion(relacion):
        """
        Desactiva una relación sin borrar el registro.
        """

        if not relacion.activo:
            raise ValidationError(
                'La relación ya se encuentra inactiva.'
            )

        relacion.activo = False
        relacion.save(update_fields=['activo'])

        return relacion