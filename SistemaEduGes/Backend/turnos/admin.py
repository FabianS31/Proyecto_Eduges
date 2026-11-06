
from django.contrib import admin
from .models import Turno, EstadoTurno, RegistroSesion


@admin.register(Turno)
class TurnoAdmin(admin.ModelAdmin):
    list_display = ('fecha', 'hora', 'profesional', 'paciente', 'estado')
    list_filter = ('fecha', 'estado', 'profesional')
    ordering = ('-fecha', '-hora')


@admin.register(RegistroSesion)
class RegistroSesionAdmin(admin.ModelAdmin):
    list_display = (
        'id_registro_sesion',
        'trabajo_sesion',
        'diagnostico',
        'nota_sesion',
    )
    search_fields = (
        'trabajo_sesion',
        'diagnostico',
        'nota_sesion',
    )


admin.site.register(EstadoTurno)