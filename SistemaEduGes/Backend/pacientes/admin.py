from django.contrib import admin
from .models import (
    Paciente,
    Tutor,
    ObraSocial,
    Parentesco,
    TipoObraSocial,
    EstadoPaciente,
    EstadoObraSocial,
    PacienteTutor,
)

@admin.register(Paciente)
class PacienteAdmin(admin.ModelAdmin):
    list_display = ('dni', 'apellido', 'nombre', 'obra_social', 'estado', 'cud_vencimiento')
    search_fields = ('dni', 'apellido', 'nombre')
    list_filter = ('estado', 'obra_social')

@admin.register(Tutor)
class TutorAdmin(admin.ModelAdmin):
    list_display = ('apellido', 'nombre', 'telefono_movil', 'mail')
    search_fields = ('apellido', 'nombre', 'mail')

@admin.register(ObraSocial)
class ObraSocialAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'contacto', 'mail', 'tipo', 'estado')
    search_fields = ('nombre',)

admin.site.register(Parentesco)
admin.site.register(TipoObraSocial)
admin.site.register(EstadoPaciente)
admin.site.register(EstadoObraSocial)
admin.site.register(PacienteTutor)