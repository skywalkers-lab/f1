from pitwall.decoders.header import HEADER_STRUCT, PacketDecodeError, parse_header


def test_parse_header_success():
    data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 1, 123, 1.5, 10, 10, 0, 255)
    header = parse_header(data + b"x")
    assert header.packet_format == 2025
    assert header.packet_id == 1
    assert header.session_uid == 123


def test_parse_header_truncated():
    try:
        parse_header(b"\x00")
        assert False, "expected error"
    except PacketDecodeError:
        assert True
