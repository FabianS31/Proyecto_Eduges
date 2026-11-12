from django.urls import path
from .administradores import AdministradorCrearView

from .views import (
    LoginView,
    LogoutView,
    MeView,
    CsrfView,
    CambiarPasswordView
)


urlpatterns = [
    path('administradores/', AdministradorCrearView.as_view(), name='administradores-create'),
    path(
        'csrf/',
        CsrfView.as_view(),
        name='csrf'
    ),

    path(
        'login/',
        LoginView.as_view(),
        name='login'
    ),

    path(
        'logout/',
        LogoutView.as_view(),
        name='logout'
    ),

    path(
        'me/',
        MeView.as_view(),
        name='me'
    ),

    path(
        'cambiar-password/',
        CambiarPasswordView.as_view(),
        name='cambiar-password'
    ),
]
