import logging
from collections.abc import Iterator
from struct import Struct

logger = logging.getLogger(__name__)

RECORD_HEADER = Struct("<dI")
_MAX_RECORD_SIZE = 65535  # 64 KiB sanity limit per record


def read_records(path: str) -> Iterator[tuple[float, bytes]]:
    with open(path, "rb") as f:
        while True:
            hdr = f.read(RECORD_HEADER.size)
            if not hdr:
                break
            ts, size = RECORD_HEADER.unpack(hdr)
            if ts < 0:
                logger.warning("Negative timestamp %.3f in %s, skipping", ts, path)
                break
            if size > _MAX_RECORD_SIZE:
                logger.warning("Record size %d exceeds limit in %s, stopping", size, path)
                break
            payload = f.read(size)
            if len(payload) != size:
                break
            yield ts, payload
