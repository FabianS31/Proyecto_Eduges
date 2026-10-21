
from django.urls import path

from APIs.tutores.views import (
    TutorListCreateView,
    TutorDetailView,
    RelacionTutorDetailView,
)


urlpatterns = [
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