from dataclasses import dataclass
from pitwall.decoders.header import PacketDecodeError, parse_header
from pitwall.decoders.models import PacketId, PacketHeader
from pitwall.decoders.packets import (
    DecodedPacket,
    decode_car_status,
    decode_car_telemetry,
    decode_event,
    decode_lap_data,
    decode_motion,
    decode_session,
)


@dataclass(frozen=True)
class RoutedPacket:
    header: PacketHeader
    decoded: DecodedPacket | None
    diagnostic: str | None = None


SUPPORTED_PACKET_VERSION = 1


def route_packet(data: bytes) -> RoutedPacket:
    try:
        header = parse_header(data)
    except PacketDecodeError as exc:
        return RoutedPacket(
            header=PacketHeader(0, 0, 0, 0, 0, -1, 0, 0.0, 0, 0, 0, 0),
            decoded=None,
            diagnostic=str(exc),
        )

    if header.packet_version != SUPPORTED_PACKET_VERSION:
        return RoutedPacket(header=header, decoded=None, diagnostic="unsupported version")

    try:
        packet_id = PacketId(header.packet_id)
    except ValueError:
        return RoutedPacket(header=header, decoded=None, diagnostic="unknown packet id")

    if packet_id == PacketId.MOTION:
        return RoutedPacket(header=header, decoded=decode_motion(data))
    if packet_id == PacketId.SESSION:
        return RoutedPacket(header=header, decoded=decode_session(data))
    if packet_id == PacketId.LAP_DATA:
        return RoutedPacket(header=header, decoded=decode_lap_data(data))
    if packet_id == PacketId.EVENT:
        return RoutedPacket(header=header, decoded=decode_event(data))
    if packet_id == PacketId.CAR_TELEMETRY:
        return RoutedPacket(
            header=header, decoded=decode_car_telemetry(data, header.player_car_index)
        )
    if packet_id == PacketId.CAR_STATUS:
        return RoutedPacket(header=header, decoded=decode_car_status(data, header.player_car_index))

    return RoutedPacket(header=header, decoded=None, diagnostic="packet id not implemented")
