from django.contrib import admin
from .models import Usuario, Rol

@admin.register(Usuario)
class UsuarioAdmin(admin.ModelAdmin):
    list_display = ('id_usuario', 'usuario', 'rol')
    search_fields = ('usuario',)

admin.site.register(Rol)