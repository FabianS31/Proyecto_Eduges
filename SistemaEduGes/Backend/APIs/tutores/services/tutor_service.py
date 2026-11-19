from functools import wraps

from django.db import IntegrityError, transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from pacientes.models import Paciente, Tutor, PacienteTutor
from profesionales.models.asignacion_model import AsignacionProfesional


def conflicto_principal():
    return ValidationError({
        'responsable_principal': 'Existe otro vínculo marcado como responsable principal, incluso si está inactivo. La situación requiere revisión antes de designar otro.'
    })


def controlar_conflicto_principal(operacion):
    """Aplicar por fuera de atomic: primero revertir, luego traducir el error."""
    @wraps(operacion)
    def ejecutar(*args, **kwargs):
        try:
            return operacion(*args, **kwargs)
        except IntegrityError as error:
            causa = error.__cause__
            diagnostico = getattr(causa, 'diag', None)
            if (
                (getattr(causa, 'sqlstate', None) or getattr(causa, 'pgcode', None)) == '23505'
                and getattr(diagnostico, 'constraint_name', None) == 'uq_paciente_responsable_principal'
                and getattr(diagnostico, 'table_name', None) == 'pacientes_tutores'
            ):
                raise conflicto_principal() from error
            raise
    return ejecutar


class TutorService:

    @staticmethod
    def validar_principal_disponible(paciente_id, excluir_id=None):
        # El llamador ya bloqueó al paciente. El índice incluye inactivos.
        otros = PacienteTutor.objects.filter(
            paciente_id=paciente_id, responsable_principal=True,
        )
        if excluir_id is not None:
            otros = otros.exclude(pk=excluir_id)
        if otros.exists():
            raise conflicto_principal()

    @staticmethod
    def exigir_telefono_principal(tutor_id):
        # Mismo bloqueo que la edición del contacto; no usar Movil como sustituto.
        tutor = Tutor.objects.select_for_update().get(pk=tutor_id)
        if not (tutor.telefono or '').strip():
            raise ValidationError({
                'telefono': 'El responsable principal debe tener teléfono. Completá su teléfono mediante una edición autorizada antes de designarlo.'
            })

    @staticmethod
    def buscar_tutor_autorizado(dni, usuario):
        """Preselección sin exponer tutores ajenos; se reautoriza bajo bloqueo."""
        rol = getattr(getattr(usuario, 'rol', None), 'rol', None)
        consulta = Tutor.objects.filter(dni=dni)
        if rol == 'Profesional':
            propios = AsignacionProfesional.objects.filter(
                profesional__usuario=usuario, fecha_fin__isnull=True,
            ).values('paciente_id')
            visibles = PacienteTutor.objects.filter(
                paciente_id__in=propios, activo=True,
            ).values('tutor_id')
            consulta = consulta.filter(pk__in=visibles)
        elif rol not in ('Administrador', 'SuperAdministrador'):
            return None
        return consulta.first()

    @staticmethod
    def bloquear_paciente(paciente_id, usuario):
        """Toda escritura de relaciones toma primero el mismo bloqueo del paciente."""
        paciente = Paciente.objects.select_for_update().get(pk=paciente_id)
        rol = getattr(getattr(usuario, 'rol', None), 'rol', None)
        if rol == 'Profesional':
            if not AsignacionProfesional.objects.filter(
                paciente=paciente, profesional__usuario=usuario, fecha_fin__isnull=True,
            ).exists():
                raise PermissionDenied('Solo podés gestionar tutores de pacientes asignados a vos.')
        elif rol not in ('Administrador', 'SuperAdministrador'):
            raise PermissionDenied('No tenés permiso para gestionar tutores.')
        return paciente

    @staticmethod
    def verificar_acceso_tutor(tutor, usuario, pacientes_bloqueados):
        rol = getattr(getattr(usuario, 'rol', None), 'rol', None)
        if rol in ('Administrador', 'SuperAdministrador'):
            return
        pacientes = AsignacionProfesional.objects.filter(
            profesional__usuario=usuario, fecha_fin__isnull=True,
        ).values('paciente_id')
        if rol != 'Profesional' or not PacienteTutor.objects.filter(
            tutor=tutor, paciente_id__in=pacientes, activo=True,
        ).filter(paciente_id__in=pacientes_bloqueados).exists():
            raise PermissionDenied(
                'No se puede completar esta vinculación. Solicitá su revisión a Administración.'
            )

    @staticmethod
    def proteger_ultimo_principal(relacion):
        if relacion.activo and relacion.responsable_principal and not PacienteTutor.objects.filter(
            paciente_id=relacion.paciente_id, activo=True, responsable_principal=True,
        ).exclude(pk=relacion.pk).exists():
            raise ValidationError({
                'responsable_principal': 'Reemplazá al responsable principal antes de desvincularlo o desmarcarlo.'
            })

    @staticmethod
    @transaction.atomic
    def crear_tutor(datos_tutor, datos_relacion, usuario):
        """
        Crea un tutor o reutiliza el autorizado sin modificar sus datos,
        y crea/reactiva su relación con el paciente en una transacción.
        """
        dni = datos_tutor['dni']
        datos_tutor = datos_tutor.copy()
        tutor_existente_id = datos_tutor.pop('_tutor_existente_id', None)
        pacientes_bloqueados = {datos_relacion['paciente'].pk}
        if getattr(getattr(usuario, 'rol', None), 'rol', None) == 'Profesional':
            propios = AsignacionProfesional.objects.filter(
                profesional__usuario=usuario, fecha_fin__isnull=True,
            ).values('paciente_id')
            fuente = PacienteTutor.objects.filter(
                tutor__dni=dni, paciente_id__in=propios, activo=True,
            ).order_by('paciente_id').values_list('paciente_id', flat=True).first()
            if fuente is not None:
                pacientes_bloqueados.add(fuente)
        for paciente_id in sorted(pacientes_bloqueados):
            TutorService.bloquear_paciente(paciente_id, usuario)
        # La unicidad de DNI resuelve también altas simultáneas del mismo tutor.
        if tutor_existente_id is not None:
            # Si desapareció o cambió de DNI, nunca crear con datos incompletos.
            tutor = Tutor.objects.select_for_update().filter(pk=tutor_existente_id, dni=dni).first()
            if tutor is None:
                raise ValidationError({'detail': 'No se puede completar la vinculación. Recargá los datos.'})
            creado = False
        else:
            tutor, creado = Tutor.objects.get_or_create(dni=dni, defaults=datos_tutor)
        tutor = Tutor.objects.select_for_update().get(pk=tutor.pk)
        if not creado:
            TutorService.verificar_acceso_tutor(tutor, usuario, pacientes_bloqueados)

        TutorService.crear_relacion(
            tutor=tutor,
            datos_relacion=datos_relacion,
            usuario=usuario,
        )

        return tutor

    @staticmethod
    @transaction.atomic
    def actualizar_tutor(tutor, datos):
        """
        Actualiza solamente los campos recibidos.
        """

        tutor = Tutor.objects.select_for_update().get(pk=tutor.pk)
        if 'telefono' in datos and not (datos['telefono'] or '').strip():
            if PacienteTutor.objects.filter(tutor=tutor, activo=True, responsable_principal=True).exists():
                raise ValidationError({'telefono': 'El tutor debe conservar un teléfono por su condición de responsable principal activo.'})

        for campo, valor in datos.items():
            setattr(tutor, campo, valor)

        if datos:
            tutor.save(update_fields=list(datos.keys()))

        return tutor

    @staticmethod
    @controlar_conflicto_principal
    @transaction.atomic
    def crear_relacion(tutor, datos_relacion, usuario):
        """
        Crea o reactiva la relación entre un tutor y un paciente.
        Nunca crea una segunda fila para la misma pareja.
        """

        paciente = TutorService.bloquear_paciente(datos_relacion['paciente'].pk, usuario)
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
            TutorService.exigir_telefono_principal(tutor.pk)
            TutorService.validar_principal_disponible(
                paciente.pk, relacion.pk if relacion else None,
            )

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
    @controlar_conflicto_principal
    @transaction.atomic
    def actualizar_relacion(relacion, datos, usuario):
        """
        Actualiza una relación activa o reactiva una inactiva
        cuando se solicita explícitamente activo=True.
        """

        TutorService.bloquear_paciente(relacion.paciente_id, usuario)
        relacion = PacienteTutor.objects.select_for_update().get(pk=relacion.pk)
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

        # Coincidir con el índice, que también contempla vínculos inactivos.
        if activo_solicitado and responsable_principal:
            if not relacion.activo or not relacion.responsable_principal:
                TutorService.exigir_telefono_principal(relacion.tutor_id)
            TutorService.validar_principal_disponible(paciente.pk, relacion.pk)

        if not responsable_principal:
            TutorService.proteger_ultimo_principal(relacion)

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
    def dar_baja_relacion(relacion, usuario):
        """
        Desactiva una relación sin borrar el registro.
        """

        TutorService.bloquear_paciente(relacion.paciente_id, usuario)
        relacion = PacienteTutor.objects.select_for_update().get(pk=relacion.pk)
        if not relacion.activo:
            raise ValidationError(
                'La relación ya se encuentra inactiva.'
            )

        TutorService.proteger_ultimo_principal(relacion)
        relacion.activo = False
        relacion.save(update_fields=['activo'])

        return relacion

    @staticmethod
    @controlar_conflicto_principal
    @transaction.atomic
    def reemplazar_principal(relacion, nueva_relacion_id, usuario):
        TutorService.bloquear_paciente(relacion.paciente_id, usuario)
        relaciones = list(PacienteTutor.objects.select_for_update().filter(
            paciente_id=relacion.paciente_id, activo=True,
        ).order_by('pk'))
        principales = [r for r in relaciones if r.responsable_principal]
        if len(principales) != 1 or principales[0].pk != relacion.pk:
            raise ValidationError({'detail': 'El responsable principal cambió o la situación requiere revisión. Recargá la ficha.'})
        nueva = next((r for r in relaciones if r.pk == nueva_relacion_id), None)
        if nueva is None or nueva.pk == relacion.pk:
            raise ValidationError({'nueva_relacion_id': 'Seleccioná otro tutor activo de este paciente.'})
        TutorService.exigir_telefono_principal(nueva.tutor_id)
        anterior = principales[0]
        TutorService.validar_principal_disponible(relacion.paciente_id, anterior.pk)
        anterior.responsable_principal = False
        anterior.save(update_fields=['responsable_principal'])
        nueva.responsable_principal = True
        nueva.save(update_fields=['responsable_principal'])
        return nueva
