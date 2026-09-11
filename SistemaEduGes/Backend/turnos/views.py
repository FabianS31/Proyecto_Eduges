from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from .models import Turno
from pacientes.models import Paciente
from profesionales.models import Profesional

@login_required
def dashboard_view(request):
    hoy = timezone.localdate()

    # Consultas a la base de datos
    turnos_hoy = Turno.objects.filter(fecha=hoy).select_related('paciente', 'profesional', 'estado').order_by('hora')
    
    # Contadores para las tarjetas métricas
    total_turnos_hoy = turnos_hoy.count()
    total_pacientes = Paciente.objects.count()
    turnos_pendientes = turnos_hoy.filter(estado__estado__icontains='Pendiente').count()
    turnos_completados = turnos_hoy.filter(estado__estado__icontains='Confirmado').count()

    context = {
        'hoy': hoy,
        'turnos_hoy': turnos_hoy,
        'total_turnos_hoy': total_turnos_hoy,
        'total_pacientes': total_pacientes,
        'turnos_pendientes': turnos_pendientes,
        'turnos_completados': turnos_completados,
    }

    return render(request, 'index.html', context)