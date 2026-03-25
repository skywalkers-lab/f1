from pathlib import Path
from struct import Struct
import time
import logging

logger = logging.getLogger(__name__)

RECORD_HEADER = Struct("<dI")


class RawPacketLogger:
    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, payload: bytes) -> None:
        """Append a packet to the raw log file with error handling."""
        try:
            with self.path.open("ab") as f:
                f.write(RECORD_HEADER.pack(time.time(), len(payload)))
                f.write(payload)
        except IOError as e:
            logger.error(f"Failed to write to raw log file {self.path}: {type(e).__name__}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error writing to raw log: {type(e).__name__}: {e}")
