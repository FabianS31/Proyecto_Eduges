from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class TipoObraSocial(Base):
    __tablename__ = "TIPOS_OBRAS_SOCIALES"

    ID_TipoOS: Mapped[int] = mapped_column(
        Integer,
        primary_key=True
    )

    Tipos: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )