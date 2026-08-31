from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class ObraSocial(Base):
    __tablename__ = "OBRAS_SOCIALES"

    ID_ObraSocial: Mapped[int] = mapped_column(
        Integer,
        primary_key=True
    )

    Nombre: Mapped[str] = mapped_column(
        String(150),
        nullable=False
    )

    Contacto: Mapped[str | None] = mapped_column(
        String(150),
        nullable=True
    )

    Mail: Mapped[str | None] = mapped_column(
        String(150),
        nullable=True
    )

    Web: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    ID_TipoOS: Mapped[int] = mapped_column(
        ForeignKey("TIPOS_OBRAS_SOCIALES.ID_TipoOS"),
        nullable=False
    )