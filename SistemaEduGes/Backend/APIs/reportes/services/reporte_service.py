from turnos.models.turno_model import Turno
from pacientes.models.paciente_model import Paciente
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import AsignacionProfesional


class ReportesService:
    """
    Servicio encargado de consultar y preparar los reportes
    de turnos, pacientes y profesionales.

    Los filtros son opcionales y pueden combinarse.
    Las claves foráneas se devuelven como objetos con id
    y nombre descriptivo, siguiendo el formato de EduGes.
    """

    # =====================================================
    # REPORTE DE TURNOS
    # =====================================================

    @classmethod
    def obtener_turnos(cls, *, filtros, usuario):
        consulta = (
            Turno.objects
            .select_related(
                'estado',
                'paciente',
                'profesional',
            )
            .all()
        )

        rol = getattr(
            getattr(usuario, 'rol', None),
            'rol',
            None,
        )

        # -------------------------------------------------
        # RESTRICCIÓN PARA PROFESIONALES
        # -------------------------------------------------

        if rol == 'Profesional':
            profesional = Profesional.objects.filter(
                usuario=usuario,
            ).first()

            # Si el usuario no tiene un profesional vinculado,
            # no puede consultar turnos.
            if profesional is None:
                consulta = consulta.none()
            else:
                # Un profesional nunca puede consultar los
                # turnos de otro profesional.
                consulta = consulta.filter(
                    profesional_id=profesional.id_profesional,
                )

                # Solo se permiten pacientes que tengan una
                # asignación vigente con este profesional.
                pacientes_asignados = (
                    AsignacionProfesional.objects
                    .filter(
                        profesional_id=profesional.id_profesional,
                        fecha_fin__isnull=True,
                    )
                    .values('paciente_id')
                )

                consulta = consulta.filter(
                    paciente_id__in=pacientes_asignados,
                )

                # Si intenta filtrar por otro profesional,
                # la consulta no devuelve resultados.
                profesional_solicitado = filtros.get(
                    'profesional_id'
                )

                if (
                    profesional_solicitado is not None
                    and profesional_solicitado
                    != profesional.id_profesional
                ):
                    consulta = consulta.none()

        # -------------------------------------------------
        # FILTROS DEL REPORTE DE TURNOS
        # -------------------------------------------------

        if 'estado_id' in filtros:
            consulta = consulta.filter(
                estado_id=filtros['estado_id']
            )

        if 'paciente_id' in filtros:
            consulta = consulta.filter(
                paciente_id=filtros['paciente_id']
            )

        # El filtro de profesional solo se aplica directamente
        # para roles distintos de Profesional. Para este último,
        # la restricción ya se aplicó con el usuario autenticado.
        if (
            'profesional_id' in filtros
            and rol != 'Profesional'
        ):
            consulta = consulta.filter(
                profesional_id=filtros['profesional_id']
            )

        if 'nombre' in filtros:
            consulta = consulta.filter(
                paciente__nombre__icontains=filtros['nombre']
            )

        if 'apellido' in filtros:
            consulta = consulta.filter(
                paciente__apellido__icontains=filtros['apellido']
            )

        if 'fecha_desde' in filtros:
            consulta = consulta.filter(
                fecha__gte=filtros['fecha_desde']
            )

        if 'fecha_hasta' in filtros:
            consulta = consulta.filter(
                fecha__lte=filtros['fecha_hasta']
            )

        consulta = consulta.order_by(
            'fecha',
            'hora',
            'id_turno',
        )

        resultados = [
            {
                'id': turno.id_turno,
                'fecha': turno.fecha,
                'hora': turno.hora,
                'estado': {
                    'id': turno.estado.id_estado_turno,
                    'nombre': turno.estado.estado,
                },
                'paciente': {
                    'id': turno.paciente.id_paciente,
                    'nombre': turno.paciente.nombre,
                    'apellido': turno.paciente.apellido,
                },
                'profesional': {
                    'id': turno.profesional.id_profesional,
                    'nombre': turno.profesional.nombre,
                    'apellido': turno.profesional.apellido,
                },
            }
            for turno in consulta
        ]

        return {
            'total': len(resultados),
            'resultados': resultados,
        }

    # =====================================================
    # REPORTE DE PACIENTES
    # =====================================================

    @classmethod
    def obtener_alumnos(cls, *, filtros):
        consulta = (
            Paciente.objects
            .select_related(
                'estado',
                'obra_social',
            )
            .all()
        )

        if 'paciente_id' in filtros:
            consulta = consulta.filter(
                id_paciente=filtros['paciente_id']
            )

        if 'nombre' in filtros:
            consulta = consulta.filter(
                nombre__icontains=filtros['nombre']
            )

        if 'apellido' in filtros:
            consulta = consulta.filter(
                apellido__icontains=filtros['apellido']
            )

        if 'dni' in filtros:
            consulta = consulta.filter(
                dni=filtros['dni']
            )

        if 'estado_id' in filtros:
            consulta = consulta.filter(
                estado_id=filtros['estado_id']
            )

        if 'obra_social_id' in filtros:
            consulta = consulta.filter(
                obra_social_id=filtros['obra_social_id']
            )

        consulta = consulta.order_by(
            'apellido',
            'nombre',
            'id_paciente',
        )

        resultados = [
            {
                'id': paciente.id_paciente,
                'nombre': paciente.nombre,
                'apellido': paciente.apellido,
                'dni': paciente.dni,
                'fecha_nacimiento': paciente.fecha_nacimiento,
                'direccion': paciente.direccion,
                'mail': paciente.mail,
                'consentimiento': paciente.consentimiento,
                'cud_numero': paciente.cud_numero,
                'cud_vencimiento': paciente.cud_vencimiento,
                'obra_social': {
                    'id': paciente.obra_social.id_obra_social,
                    'nombre': paciente.obra_social.nombre,
                },
                'numero_afiliado': paciente.numero_afiliado,
                'estado': {
                    'id': paciente.estado.id_estado_paciente,
                    'nombre': paciente.estado.estado,
                },
            }
            for paciente in consulta
        ]

        return {
            'total': len(resultados),
            'resultados': resultados,
        }

    # =====================================================
    # REPORTE DE PROFESIONALES
    # =====================================================

    @classmethod
    def obtener_profesionales(cls, *, filtros):
        consulta = (
            Profesional.objects
            .select_related(
                'especialidad',
                'estado_profesional',
            )
            .all()
        )

        if 'profesional_id' in filtros:
            consulta = consulta.filter(
                id_profesional=filtros['profesional_id']
            )

        if 'nombre' in filtros:
            consulta = consulta.filter(
                nombre__icontains=filtros['nombre']
            )

        if 'apellido' in filtros:
            consulta = consulta.filter(
                apellido__icontains=filtros['apellido']
            )

        if 'dni' in filtros:
            consulta = consulta.filter(
                dni=filtros['dni']
            )

        if 'matricula' in filtros:
            consulta = consulta.filter(
                matricula=filtros['matricula']
            )

        if 'especialidad_id' in filtros:
            consulta = consulta.filter(
                especialidad_id=filtros['especialidad_id']
            )

        if 'estado_id' in filtros:
            consulta = consulta.filter(
                estado_profesional_id=filtros['estado_id']
            )

        consulta = consulta.order_by(
            'apellido',
            'nombre',
            'id_profesional',
        )

        resultados = [
            {
                'id': profesional.id_profesional,
                'nombre': profesional.nombre,
                'apellido': profesional.apellido,
                'dni': profesional.dni,
                'matricula': profesional.matricula,
                'especialidad': {
                    'id': profesional.especialidad.id_especialidad,
                    'nombre': profesional.especialidad.especialidad,
                },
                'estado_profesional': {
                    'id': (
                        profesional.estado_profesional
                        .id_estado_profesional
                    ),
                    'nombre': profesional.estado_profesional.estado,
                },
                'contacto': profesional.contacto,
                'mail': profesional.mail,
            }
            for profesional in consulta
        ]

        return {
            'total': len(resultados),
            'resultados': resultados,
        }