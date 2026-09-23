from django.urls import path
from turnos.views import dashboard_view

urlpatterns = [
    path('dashboard/', dashboard_view, name='home'),
]