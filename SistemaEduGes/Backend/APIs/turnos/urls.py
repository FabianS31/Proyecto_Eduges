
from django.urls import path

from APIs.turnos.views import (
    TurnoListView,
    TurnoDetailView,
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
]