from django.urls import path
from .especialidades import EspecialidadListCreateView

from .views import (
    ProfesionalListCreateView,
    ProfesionalDetailView,
    ProfesionalEstadoView,
    ProfesionalesParaReasignacionView,
    ReasignacionPacienteView,
)

urlpatterns = [
    path('especialidades/', EspecialidadListCreateView.as_view(), name='especialidades-list-create'),

    path(
        '',
        ProfesionalListCreateView.as_view(),
        name='profesionales-list-create'
    ),

    path(
        'para-reasignacion/',
        ProfesionalesParaReasignacionView.as_view(),
        name='profesionales-para-reasignacion'
    ),

    path(
        'pacientes/<int:paciente_id>/reasignar/',
        ReasignacionPacienteView.as_view(),
        name='paciente-reasignar-profesional'
    ),

    path(
        '<int:pk>/',
        ProfesionalDetailView.as_view(),
        name='profesionales-detail'
    ),

    path(
        '<int:pk>/estado/',
        ProfesionalEstadoView.as_view(),
        name='profesionales-estado'
    ),
]
