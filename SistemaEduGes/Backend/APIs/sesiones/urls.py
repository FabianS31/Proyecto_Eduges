from django.urls import path

from APIs.sesiones.views import (
    TurnosPendientesSesionView,
    RegistroSesionCrearView,
    RegistroSesionDetalleView,
)

urlpatterns = [
    path(
        'pendientes/',
        TurnosPendientesSesionView.as_view(),
        name='sesiones-pendientes',
    ),
    path(
        '',
        RegistroSesionCrearView.as_view(),
        name='sesiones-crear',
    ),
    path(
        '<int:turno_id>/',
        RegistroSesionDetalleView.as_view(),
        name='sesiones-detalle',
    ),
]