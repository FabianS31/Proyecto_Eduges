from fastapi import FastAPI
from config.config import settings
from database import engine


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="API del sistema de gestión de Rincón Psi"
)


@app.get("/")
def inicio():
    return {
        "mensaje": "EduGes API funcionando correctamente"
    }