from django.urls import include, path
from django.views.generic import RedirectView, TemplateView


# Páginas del frontend: solo devuelven el esqueleto HTML.
# Los datos los pide el JavaScript a la API (/api/...), que es la que valida la sesión.

urlpatterns = [
    path(
        '',
        RedirectView.as_view(pattern_name='home', permanent=False)
    ),

    path(
        'dashboard/',
        TemplateView.as_view(template_name='index.html'),
        name='home'
    ),

    path(
        'profesionales/',
        TemplateView.as_view(template_name='profesionales.html'),
        name='profesionales'
    ),

    path(
        'pacientes/',
        TemplateView.as_view(template_name='pacientes.html'),
        name='pacientes'
    ),

    path(
        'turnos/',
        TemplateView.as_view(template_name='turnos.html'),
        name='turnos'
    ),

    path(
        'login/',
        TemplateView.as_view(template_name='login.html'),
        name='login'
    ),

    # API
    path(
        'api/profesionales/',
        include('APIs.profesionales.urls')
    ),

    path(
        'api/auth/',
        include('APIs.autenticacion.urls')
    ),

    path(
        'api/pacientes/',
        include('APIs.pacientes.urls')
    ),
]