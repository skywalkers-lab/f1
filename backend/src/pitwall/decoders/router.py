from dataclasses import dataclass
from pitwall.decoders.header import PacketDecodeError, parse_header
from pitwall.decoders.models import PacketId, PacketHeader
from pitwall.decoders.packets import (
    DecodedPacket,
    decode_car_damage,
    decode_car_status,
    decode_car_telemetry,
    decode_event,
    decode_lap_data,
    decode_motion,
    decode_participants,
    decode_session,
    decode_session_history,
)


@dataclass(frozen=True)
class RoutedPacket:
    header: PacketHeader
    decoded: DecodedPacket | None
    diagnostic: str | None = None


SUPPORTED_PACKET_VERSION = 1


def _resolve_player_index(header: PacketHeader) -> int:
    if 0 <= header.player_car_index < 22:
        return header.player_car_index
    if 0 <= header.secondary_player_car_index < 22:
        return header.secondary_player_car_index
    return -1


def route_packet(data: bytes) -> RoutedPacket:
    try:
        header = parse_header(data)
    except PacketDecodeError as exc:
        return RoutedPacket(
            header=PacketHeader(0, 0, 0, 0, 0, -1, 0, 0.0, 0, 0, 0, 0),
            decoded=None,
            diagnostic=str(exc),
        )

    if header.packet_version < 1:
        return RoutedPacket(header=header, decoded=None, diagnostic="unsupported version")

    try:
        packet_id = PacketId(header.packet_id)
    except ValueError:
        return RoutedPacket(header=header, decoded=None, diagnostic="unknown packet id")

    try:
        resolved_player_index = _resolve_player_index(header)
        if packet_id == PacketId.MOTION:
            return RoutedPacket(header=header, decoded=decode_motion(data))
        if packet_id == PacketId.SESSION:
            return RoutedPacket(header=header, decoded=decode_session(data))
        if packet_id == PacketId.LAP_DATA:
            return RoutedPacket(header=header, decoded=decode_lap_data(data))
        if packet_id == PacketId.EVENT:
            return RoutedPacket(header=header, decoded=decode_event(data))
        if packet_id == PacketId.PARTICIPANTS:
            return RoutedPacket(header=header, decoded=decode_participants(data))
        if packet_id == PacketId.CAR_TELEMETRY:
            return RoutedPacket(
                header=header, decoded=decode_car_telemetry(data, resolved_player_index)
            )
        if packet_id == PacketId.CAR_STATUS:
            return RoutedPacket(header=header, decoded=decode_car_status(data, resolved_player_index))
        if packet_id == PacketId.CAR_DAMAGE:
            return RoutedPacket(header=header, decoded=decode_car_damage(data))
        if packet_id == PacketId.SESSION_HISTORY:
            return RoutedPacket(header=header, decoded=decode_session_history(data))
    except PacketDecodeError as exc:
        return RoutedPacket(header=header, decoded=None, diagnostic=f"decode_error:{exc}")

    return RoutedPacket(header=header, decoded=None, diagnostic="packet id not implemented")
