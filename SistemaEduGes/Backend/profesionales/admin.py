from django.contrib import admin
from .models import Profesional, Especialidad, AsignacionProfesional

@admin.register(Profesional)
class ProfesionalAdmin(admin.ModelAdmin):
    list_display = ('matricula', 'apellido', 'nombre', 'dni', 'especialidad', 'mail')
    search_fields = ('matricula', 'apellido', 'nombre', 'dni')
    list_filter = ('especialidad',)

@admin.register(AsignacionProfesional)
class AsignacionProfesionalAdmin(admin.ModelAdmin):
    list_display = ('paciente', 'profesional', 'fecha_inicio', 'fecha_fin')
    list_filter = ('profesional', 'fecha_inicio')

admin.site.register(Especialidad)