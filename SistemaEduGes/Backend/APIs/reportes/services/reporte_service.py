
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied

from turnos.models.turno_model import Turno
from pacientes.models.paciente_model import Paciente
from profesionales.models.profesional_model import Profesional
from profesionales.models.asignacion_model import AsignacionProfesional
from pacientes.models.tutor_model import PacienteTutor


class ReportesService:
    """
    Servicio encargado de consultar y preparar los reportes
    de turnos, pacientes y profesionales.

    Los filtros son opcionales y pueden combinarse.
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
                'registro_sesion',
            )
            .all()
        )

        rol = getattr(
            getattr(usuario, 'rol', None),
            'rol',
            None,
        )

        profesional = None
        periodos_asignacion = []

        # Condiciones iniciales vacías.
        condicion_periodo_propio = Q(pk__in=[])

        # -------------------------------------------------
        # RESTRICCIONES PARA PROFESIONALES
        # -------------------------------------------------

        if rol == 'Profesional':
            profesional = Profesional.objects.filter(
                usuario=usuario,
            ).first()

            if profesional is None:
                consulta = consulta.none()

            else:
                periodos_asignacion = list(
                    AsignacionProfesional.objects
                    .filter(
                        profesional_id=profesional.id_profesional,
                    )
                    .values(
                        'paciente_id',
                        'fecha_inicio',
                        'fecha_fin',
                    )
                )

                # -------------------------------------------------
                # TURNOS PROPIOS DURANTE LOS PERÍODOS DE ASIGNACIÓN
                # -------------------------------------------------

                for asignacion in periodos_asignacion:
                    condicion_periodo = Q(
                        paciente_id=asignacion['paciente_id'],
                        profesional_id=profesional.id_profesional,
                        fecha__gte=asignacion['fecha_inicio'],
                    )

                    # Incluye el día final; la autoría sigue limitada al profesional.
                    if asignacion['fecha_fin'] is not None:
                        condicion_periodo &= Q(
                            fecha__lte=asignacion['fecha_fin'],
                        )

                    condicion_periodo_propio |= condicion_periodo

                # Solo actividad propia dentro de los periodos ya autorizados.
                consulta = consulta.filter(condicion_periodo_propio)

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

        if 'tutor_id' in filtros:
            pacientes_del_tutor = PacienteTutor.objects.filter(
                tutor_id=filtros['tutor_id'],
                activo=True,
            ).values_list(
                'paciente_id',
                flat=True,
            )

            consulta = consulta.filter(
                paciente_id__in=pacientes_del_tutor,
            )

        if 'profesional_id' in filtros:
            if rol == 'Profesional':
                if (
                    profesional is None
                    or filtros['profesional_id']
                    != profesional.id_profesional
                ):
                    consulta = consulta.none()
            else:
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

        # -------------------------------------------------
        # FILTRO POR TRABAJO DE SESIÓN
        # -------------------------------------------------

        if filtros.get('trabajo_sesion'):
            if rol == 'Administrador':
                raise PermissionDenied(
                    'No tenés permisos para filtrar por trabajo de sesión.'
                )

            if rol == 'Profesional':
                # El profesional solamente puede buscar trabajos
                # de sesión correspondientes a sus propios períodos.
                consulta = consulta.filter(
                    condicion_periodo_propio,
                    registro_sesion__trabajo_sesion__icontains=(
                        filtros['trabajo_sesion']
                    ),
                )
            else:
                consulta = consulta.filter(
                    registro_sesion__trabajo_sesion__icontains=(
                        filtros['trabajo_sesion']
                    )
                )

        # -------------------------------------------------
        # FILTRO POR DIAGNÓSTICO
        # -------------------------------------------------

        if filtros.get('diagnostico'):
            consulta = consulta.filter(
                registro_sesion__diagnostico__icontains=(
                    filtros['diagnostico']
                )
            )

        consulta = consulta.order_by(
            'fecha',
            'hora',
            'id_turno',
        )

        # -------------------------------------------------
        # RESULTADOS
        # -------------------------------------------------

        resultados = []

        for turno in consulta:
            resultado = {
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

            registro = turno.registro_sesion

            # -------------------------------------------------
            # ADMINISTRADOR
            # -------------------------------------------------

            if rol == 'Administrador':
                # Solamente puede recibir el diagnóstico.
                resultado['diagnostico'] = (
                    registro.diagnostico if registro else None
                )

            # -------------------------------------------------
            # PROFESIONAL
            # -------------------------------------------------

            elif rol == 'Profesional':
                # Verifica si el turno pertenece a un período
                # en el que este profesional tuvo asignado al paciente.
                tiene_acceso_completo = (
                    profesional is not None
                    and turno.profesional_id
                    == profesional.id_profesional
                    and any(
                        asignacion['paciente_id'] == turno.paciente_id
                        and turno.fecha >= asignacion['fecha_inicio']
                        and (
                            asignacion['fecha_fin'] is None
                            or turno.fecha <= asignacion['fecha_fin']
                        )
                        for asignacion in periodos_asignacion
                    )
                )

                # Todos los profesionales autorizados pueden
                # consultar el diagnóstico de los turnos visibles.
                resultado['diagnostico'] = (
                    registro.diagnostico if registro else None
                )

                if tiene_acceso_completo:
                    # Acceso completo durante su propio período.
                    resultado['trabajo_sesion'] = (
                        registro.trabajo_sesion if registro else None
                    )
                    resultado['nota_sesion'] = (
                        registro.nota_sesion if registro else None
                    )

                # Si es un turno histórico de otro profesional,
                # no se agregan TrabajoSesion ni NotaSesion.

            # -------------------------------------------------
            # SUPERADMINISTRADOR
            # -------------------------------------------------

            elif rol == 'SuperAdministrador':
                # Acceso completo a los tres campos.
                resultado['diagnostico'] = (
                    registro.diagnostico if registro else None
                )
                resultado['trabajo_sesion'] = (
                    registro.trabajo_sesion if registro else None
                )
                resultado['nota_sesion'] = (
                    registro.nota_sesion if registro else None
                )

            resultados.append(resultado)

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

        if 'tutor_id' in filtros:
            pacientes_del_tutor = PacienteTutor.objects.filter(
                tutor_id=filtros['tutor_id'],
                activo=True,
            ).values_list(
                'paciente_id',
                flat=True,
            )

            consulta = consulta.filter(
                id_paciente__in=pacientes_del_tutor,
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

        if 'fecha_alta_desde' in filtros:
            consulta = consulta.filter(
                fecha_alta__gte=filtros['fecha_alta_desde']
            )

        if 'fecha_alta_hasta' in filtros:
            consulta = consulta.filter(
                fecha_alta__lte=filtros['fecha_alta_hasta']
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
                'fecha_alta': paciente.fecha_alta,
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