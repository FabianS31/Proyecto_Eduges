
from django.urls import path

from APIs.turnos.views import (
    TurnoListView,
    TurnoDetailView,
    TurnoEstadoView,
)


urlpatterns = [
    path(
        '',
        TurnoListView.as_view(),
        name='turnos-list',
    ),
    path(
        '<int:turno_id>/',
        TurnoDetailView.as_view(),
        name='turnos-detail',
    ),
    path(
        '<int:turno_id>/estado/',
        TurnoEstadoView.as_view(),
        name='turnos-estado',
    ),
]