from pathlib import Path
from struct import Struct
import time


RECORD_HEADER = Struct("<dI")


class RawPacketLogger:
    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, payload: bytes) -> None:
        with self.path.open("ab") as f:
            f.write(RECORD_HEADER.pack(time.time(), len(payload)))
            f.write(payload)
