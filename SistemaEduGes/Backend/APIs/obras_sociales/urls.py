
from django.urls import path

from APIs.obras_sociales.views import (
    ObraSocialListView,
    ObraSocialDetailView,
)

urlpatterns = [
    path(
        '',
        ObraSocialListView.as_view(),
        name='obras-sociales-list',
    ),
    path(
        '<int:obra_social_id>/',
        ObraSocialDetailView.as_view(),
        name='obras-sociales-detail',
    ),
]
