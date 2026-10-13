from django.urls import path

from APIs.turnos.views import TurnoListView


urlpatterns = [
    path('', TurnoListView.as_view(), name='turnos-list'),
]