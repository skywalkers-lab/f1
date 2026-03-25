from struct import Struct
from pitwall.decoders.models import PacketHeader


# SPEC ASSUMPTION (F1 25): packet header layout follows F1 23/24 style with little-endian packing.
HEADER_STRUCT = Struct("<HBBBBBQfIIBB")


class PacketDecodeError(ValueError):
    pass


def parse_header(data: bytes) -> PacketHeader:
    if len(data) < HEADER_STRUCT.size:
        raise PacketDecodeError(
            f"truncated packet: expected at least {HEADER_STRUCT.size} bytes, got {len(data)}"
        )
    values = HEADER_STRUCT.unpack_from(data)
    return PacketHeader(*values)
