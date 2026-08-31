from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class Paciente(Base):
    __tablename__ = "PACIENTES"

    ID_Paciente: Mapped[int] = mapped_column(
        Integer,
        primary_key=True
    )

    Nombre: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )

    Apellido: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )

    DNI: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )

    FechaNacimiento: Mapped[date] = mapped_column(
        Date,
        nullable=False
    )

    Dirección: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    Teléfono: Mapped[str | None] = mapped_column(
        String(30),
        nullable=True
    )

    CUD_Vencimiento: Mapped[date] = mapped_column(
        Date,
        nullable=False
    )

    ID_ObraSocial: Mapped[int] = mapped_column(
        ForeignKey("OBRAS_SOCIALES.ID_ObraSocial"),
        nullable=False
    )

    ID_EstadoPaciente: Mapped[int] = mapped_column(
        ForeignKey("ESTADOS_PACIENTES.ID_EstadoPaciente"),
        nullable=False
    )