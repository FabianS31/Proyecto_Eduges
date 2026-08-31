from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class EstadoPaciente(Base):
    __tablename__ = "ESTADOS_PACIENTES"

    ID_EstadoPaciente: Mapped[int] = mapped_column(
        Integer,
        primary_key=True
    )

    Estado: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )