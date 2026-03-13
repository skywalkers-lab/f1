from collections.abc import Iterator
from struct import Struct


RECORD_HEADER = Struct("<dI")


def read_records(path: str) -> Iterator[tuple[float, bytes]]:
    with open(path, "rb") as f:
        while True:
            hdr = f.read(RECORD_HEADER.size)
            if not hdr:
                break
            ts, size = RECORD_HEADER.unpack(hdr)
            payload = f.read(size)
            if len(payload) != size:
                break
            yield ts, payload
