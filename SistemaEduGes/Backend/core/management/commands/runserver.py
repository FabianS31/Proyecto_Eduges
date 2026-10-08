import hashlib
from pathlib import Path

from django.contrib.staticfiles.management.commands.runserver import (
    Command as DjangoRunserverCommand,
)
from django.core.management import call_command
from django.conf import settings


class Command(DjangoRunserverCommand):
    def calcular_hash_static(self):
        """
        Calcula una firma SHA-256 de todos los archivos de Frontend/static.
        Detecta modificaciones, archivos nuevos, eliminados o renombrados.
        """
        static_dir = Path(self.get_static_dir())

        if not static_dir.exists():
            return None

        hash_obj = hashlib.sha256()

        archivos = sorted(
            archivo
            for archivo in static_dir.rglob('*')
            if archivo.is_file()
        )

        for archivo in archivos:
            ruta_relativa = archivo.relative_to(static_dir)

            hash_obj.update(str(ruta_relativa).encode('utf-8'))
            hash_obj.update(archivo.read_bytes())

        return hash_obj.hexdigest()

    def get_static_dir(self):
        """
        Obtiene la carpeta Frontend/static.
        """
        backend_dir = Path(__file__).resolve().parents[3]
        return backend_dir.parent / 'Frontend' / 'static'

    def actualizar_static(self):
        """
        Ejecuta collectstatic solamente cuando es necesario.
        """
        # En desarrollo Django sirve directamente Frontend/static.
        if settings.DEBUG:
            return

        hash_actual = self.calcular_hash_static()

        if hash_actual is None:
            self.stdout.write(
                self.style.WARNING(
                    '>>> EDUGES: No se encontró Frontend/static <<<'
                )
            )
            return

        backend_dir = Path(__file__).resolve().parents[3]
        archivo_hash = backend_dir / '.eduges_static_hash'
        static_root = Path(settings.STATIC_ROOT)

        hash_anterior = None

        if archivo_hash.exists():
            hash_anterior = archivo_hash.read_text(
                encoding='utf-8'
            ).strip()

        if hash_actual == hash_anterior and static_root.exists():
            self.stdout.write(
                '>>> EDUGES: Static sin cambios. '
                'No se ejecuta collectstatic. <<<'
            )
            return

        self.stdout.write(
            self.style.WARNING(
                '>>> EDUGES: Cambios en static detectados. '
                'Ejecutando collectstatic... <<<'
            )
        )

        call_command('collectstatic', '--noinput')

        archivo_hash.write_text(
            hash_actual,
            encoding='utf-8'
        )

        self.stdout.write(
            self.style.SUCCESS(
                '>>> EDUGES: Static actualizado correctamente. <<<'
            )
        )

    def run(self, **options):
        """
        Punto de entrada personalizado de runserver.
        """
        self.actualizar_static()

        super().run(**options)