
from django.urls import include, path
from django.views.generic import RedirectView, TemplateView
from APIs.sesiones import urls as sesiones_urls


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
        'reportes/',
        TemplateView.as_view(template_name='reportes.html'),
        name='reportes'
    ),

    path(
        'login/',
        TemplateView.as_view(template_name='login.html'),
        name='login'
    ),

    # API de profesionales
    path(
        'api/profesionales/',
        include('APIs.profesionales.urls')
    ),

    # API de autenticación
    path(
        'api/auth/',
        include('APIs.autenticacion.urls')
    ),

    # API de pacientes
    path(
        'api/pacientes/',
        include('APIs.pacientes.urls')
    ),

    # API de turnos
    path(
        'api/turnos/',
        include('APIs.turnos.urls')
    ),

    # API de tutores
    path(
        'api/tutores/',
        include('APIs.tutores.urls'),
    ),

    # API de reportes
    path(
        'api/reportes/',
        include('APIs.reportes.urls')
    ),

    path(
        'api/sesiones/',
        include(sesiones_urls)
    ),

    # API de obras sociales
    path(
        'api/obras-sociales/',
        include('APIs.obras_sociales.urls')
    ),

]
