from django.core.cache import cache


MAX_INTENTOS = 5
DURACION_BLOQUEO = 60


def obtener_clave(usuario):
    return f'login_failed:{usuario}'


def obtener_intentos(usuario):
    clave = obtener_clave(usuario)

    return cache.get(clave, 0)


def registrar_intento_fallido(usuario):
    clave = obtener_clave(usuario)

    intentos = cache.get(clave, 0) + 1

    cache.set(
        clave,
        intentos,
        DURACION_BLOQUEO
    )

    return intentos


def reiniciar_intentos(usuario):
    clave = obtener_clave(usuario)

    cache.delete(clave)


def esta_bloqueado(usuario):
    intentos = obtener_intentos(usuario)

    return intentos >= MAX_INTENTOS