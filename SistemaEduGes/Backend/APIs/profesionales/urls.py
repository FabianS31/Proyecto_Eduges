from django.urls import path

from .views import (
ProfesionalListCreateView,
ProfesionalDetailView,
)

urlpatterns = [

    path(
        '',
        ProfesionalListCreateView.as_view(),
        name='profesionales-list-create'
    ),

    path(
        '<int:pk>/',
        ProfesionalDetailView.as_view(),
        name='profesionales-detail'
    ),
]