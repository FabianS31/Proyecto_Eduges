from django.urls import path

from .views import PacienteListView


urlpatterns = [
    path('', PacienteListView.as_view(), name='pacientes-list'),
]