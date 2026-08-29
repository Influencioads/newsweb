"""Model registry for Alembic.

`app.models` imports every model module; re-exporting it here gives
`alembic/env.py` a single, obvious import to pull in the full metadata.
"""

from app.models import *  # noqa: F403
from app.models import __all__ as _model_names

__all__ = list(_model_names)
