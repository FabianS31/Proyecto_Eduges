from django.urls import path

from .views import (
    PacienteListView,
    PacienteDetailView,
    PacienteAltaResultadoView,
    PacienteEstadoView
)


urlpatterns = [
    path('alta/resultado/', PacienteAltaResultadoView.as_view(), name='pacientes-alta-resultado'),
    path('<int:paciente_id>/', PacienteDetailView.as_view(), name='pacientes-detail'),
    path(
        '',
        PacienteListView.as_view(),
        name='pacientes-list'
    ),
    path(
        '<int:paciente_id>/estado/',
        PacienteEstadoView.as_view(),
        name='pacientes-estado'
    ),
]
