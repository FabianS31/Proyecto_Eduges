
from django.urls import path

from APIs.tutores.views import (
    TutorListCreateView,
    TutorDetailView,
    RelacionTutorDetailView,
    ReemplazarPrincipalView,
    ParentescoListView,
)


urlpatterns = [
    path('parentescos/', ParentescoListView.as_view(), name='tutores-parentescos'),
    path('relaciones/<int:pk>/reemplazar-principal/', ReemplazarPrincipalView.as_view(), name='tutores-reemplazar-principal'),
    path(
        '',
        TutorListCreateView.as_view(),
        name='tutores-list-create',
    ),
    path(
        '<int:pk>/',
        TutorDetailView.as_view(),
        name='tutores-detail',
    ),
    path(
        'relaciones/<int:pk>/',
        RelacionTutorDetailView.as_view(),
        name='tutores-relacion-detail',
    ),
]
