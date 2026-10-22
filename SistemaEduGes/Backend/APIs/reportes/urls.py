from django.urls import path

from APIs.reportes.views import (
    ReporteTurnosView,
    ReporteAlumnosView,
    ReporteProfesionalesView,
)

urlpatterns = [
    path('turnos/', ReporteTurnosView.as_view(), name='reporte-turnos'),
    path('pacientes/', ReporteAlumnosView.as_view(), name='reporte-pacientes'),
    path('profesionales/', ReporteProfesionalesView.as_view(), name='reporte-profesionales'),
]