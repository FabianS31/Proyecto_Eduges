from django.db import models


class Rol(models.Model):
    id_rol = models.AutoField(
        primary_key=True,
        db_column='ID_Rol'
    )

    rol = models.CharField(
        max_length=50,
        db_column='Rol'
    )

    class Meta:
        managed = False
        db_table = 'roles'


class Permiso(models.Model):
    id_permiso = models.AutoField(
        primary_key=True,
        db_column='ID_Permiso'
    )

    permiso = models.CharField(
        max_length=20,
        db_column='Permiso'
    )

    descripcion = models.CharField(
        max_length=250,
        db_column='Descripcion'
    )

    class Meta:
        managed = False
        db_table = 'permisos'


class RolPermiso(models.Model):
    id_rol_permiso = models.AutoField(
        primary_key=True,
        db_column='ID_RolPermiso'
    )

    rol = models.ForeignKey(
        Rol,
        on_delete=models.CASCADE,
        db_column='ID_Rol'
    )

    permiso = models.ForeignKey(
        Permiso,
        on_delete=models.CASCADE,
        db_column='ID_Permiso'
    )

    class Meta:
        managed = False
        db_table = 'roles_permisos'