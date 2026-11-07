from django.urls import path

from .views import (
    PacienteListView,
    PacienteEstadoView
)


urlpatterns = [
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