#!/usr/bin/env python3
"""
Simulated F1 25 UDP telemetry sender for testing without the actual game.

Sends realistic packets to the backend at approximately game rate (~20 Hz).
Simulates a 5-lap race at Monaco with 22 cars.

Usage:
    python test_udp_sender.py                  # default: localhost:20777
    python test_udp_sender.py --host 127.0.0.1 --port 20777
"""

import argparse
import math
import random
import socket
import struct
import time

# ─── Header layout: <HBBBBBQfIIBB (29 bytes) ────────────────────────────
HEADER_FMT = "<HBBBBBQfIIBB"
HEADER_SIZE = struct.calcsize(HEADER_FMT)

# Packet IDs
MOTION = 0
SESSION = 1
LAP_DATA = 2
EVENT = 3
PARTICIPANTS = 4
CAR_TELEMETRY = 6
CAR_STATUS = 7

CAR_COUNT = 22
SESSION_UID = random.randint(1, 2**63)
TOTAL_LAPS = 5
TRACK_ID = 21  # Monaco
NICKNAMES = [
    "MAX_VERSTAPPEN", "LANDO_NORRIS", "LECLERC", "HAMILTON", "RUSSELL", "PIASTRI",
    "ALONSO", "SAINZ", "PEREZ", "GASLY", "ALBON", "STROLL",
    "TSUNODA", "HULKENBERG", "OCON", "MAGNUSSEN", "BOTTAS", "ZHOU",
    "RICCIARDO", "LAWSON", "BEARMAN", "ANTONELLI",
]


def make_header(packet_id: int, frame: int, session_time: float) -> bytes:
    return struct.pack(
        HEADER_FMT,
        2025,           # packet_format (F1 25)
        25,             # game_year
        1,              # game_major_version
        0,              # game_minor_version
        1,              # packet_version
        packet_id,      # packet_id
        SESSION_UID,    # session_uid
        session_time,   # session_time
        frame,          # frame_identifier
        frame,          # overall_frame_identifier
        0,              # player_car_index (car 0)
        255,            # secondary_player_car_index (none)
    )


def make_session_packet(frame: int, t: float) -> bytes:
    header = make_header(SESSION, frame, t)
    # SESSION_STRUCT = <BBBBB (weather, trackTemp, airTemp, totalLaps, trackId)
    body = struct.pack("<BBBBB", 0, 30, 22, TOTAL_LAPS, TRACK_ID)
    # session_type at offset+5, padding at +6, safety_car_status at +7, extra pad
    body += struct.pack("<BBBB", 10, 0, 0, 0)  # 10 = Race, pad to satisfy _ensure_size
    return header + body


def make_motion_packet(frame: int, t: float, lap_progress: float) -> bytes:
    """Generate motion data - 22 cars on an elliptical track."""
    header = make_header(MOTION, frame, t)
    body = b""
    for i in range(CAR_COUNT):
        angle = lap_progress * 2 * math.pi + (i * 2 * math.pi / CAR_COUNT)
        x = 300.0 * math.cos(angle) + random.uniform(-2, 2)
        z = 150.0 * math.sin(angle) + random.uniform(-2, 2)
        # Full record is 60 bytes; first 12 bytes are (x, y, z) as floats
        car_data = struct.pack("<fff", x, 0.0, z)
        car_data += b"\x00" * (60 - len(car_data))  # Pad to 60 bytes
        body += car_data
    return header + body


def make_lap_data_packet(frame: int, t: float, current_lap: int) -> bytes:
    """Generate lap data for all 22 cars."""
    header = make_header(LAP_DATA, frame, t)
    body = b""
    for i in range(CAR_COUNT):
        record = bytearray(57)
        lap_time_ms = int(80000 + i * 500 + random.uniform(-200, 200))
        current_time_ms = int(t * 1000) % 90000
        # lastLapTimeInMS(u32) + currentLapTimeInMS(u32) at offset 0
        struct.pack_into("<II", record, 0, lap_time_ms, current_time_ms)
        # delta to front(u16) + delta to leader(u16) at offset 14
        struct.pack_into("<HH", record, 14, i * 500, i * 500)
        # carPosition(u8) + currentLapNum(u8) at offset 30
        struct.pack_into("<BB", record, 30, min(i + 1, 22), current_lap)
        # pitStatus at 32
        record[32] = 0  # not in pit
        body += bytes(record)
    return header + body


def make_car_telemetry_packet(frame: int, t: float) -> bytes:
    """Generate car telemetry for 22 cars."""
    header = make_header(CAR_TELEMETRY, frame, t)
    body = b""
    for i in range(CAR_COUNT):
        record = bytearray(60)
        speed = max(0, min(360, int(280 - i * 3 + random.uniform(-10, 10))))
        throttle = max(0.0, min(1.0, 0.9 - random.uniform(0, 0.3)))
        steer = random.uniform(-0.3, 0.3)
        brake = max(0.0, min(1.0, random.uniform(0, 0.2)))
        gear = min(8, max(1, 7 - i // 5))
        rpm = max(3000, min(15000, int(12000 - i * 200 + random.uniform(-500, 500))))
        drs = 1 if i < 5 and random.random() > 0.7 else 0
        # speed(u16) throttle(f) steer(f) brake(f) clutch(u8) gear(i8) engineRPM(u16) drs(u8)
        struct.pack_into("<HfffBbHB", record, 0, speed, throttle, steer, brake, 0, gear, rpm, drs)
        # Temps at offset 22: 4×u16(brake) + 4×u8(tyre_surface) + 4×u8(tyre_inner) + u16(engine)
        brake_temps = [random.randint(200, 500) for _ in range(4)]
        surface_temps = [random.randint(80, 110) for _ in range(4)]
        inner_temps = [random.randint(85, 105) for _ in range(4)]
        engine_temp = random.randint(100, 120)
        struct.pack_into("<4H4B4BH", record, 22,
                         *brake_temps, *surface_temps, *inner_temps, engine_temp)
        body += bytes(record)
    return header + body


def make_car_status_packet(frame: int, t: float, current_lap: int) -> bytes:
    """Generate car status for 22 cars."""
    header = make_header(CAR_STATUS, frame, t)
    body = b""
    for i in range(CAR_COUNT):
        record = bytearray(55)
        fuel = max(0.0, 80.0 - current_lap * 3.0 + random.uniform(-1, 1))
        ers = max(0.0, min(4_000_000.0, 2_500_000.0 + random.uniform(-500000, 500000)))
        tyre_compound = 16 if i % 3 == 0 else (17 if i % 3 == 1 else 18)  # C1/C2/C3
        tyre_age = current_lap + random.randint(0, 2)
        # fuel at offset 5
        struct.pack_into("<f", record, 5, fuel)
        # visual_tyre_compound at offset 26
        record[26] = tyre_compound
        # ers_store_energy at offset 37
        struct.pack_into("<f", record, 37, ers)
        # tyres_age_laps at offset 52
        record[52] = min(255, tyre_age)
        body += bytes(record)
    return header + body


def make_event_packet(frame: int, t: float, code: str = "SSTA") -> bytes:
    """Generate an event packet."""
    header = make_header(EVENT, frame, t)
    body = struct.pack("<4s", code.encode("ascii")[:4].ljust(4, b"\x00"))
    return header + body


def make_participants_packet(frame: int, t: float) -> bytes:
    """Generate participants packet with 22 nickname entries."""
    header = make_header(PARTICIPANTS, frame, t)
    body = bytearray()
    body.extend(struct.pack("<B", CAR_COUNT))  # m_numActiveCars

    for i in range(CAR_COUNT):
        name_raw = NICKNAMES[i % len(NICKNAMES)].encode("utf-8")[:48]
        name_padded = name_raw.ljust(48, b"\x00")
        # aiControlled, driverId, networkId, teamId, myTeam, raceNumber, nationality
        record = struct.pack("<7B", 0, i, i, i % 10, 0, i + 1, 0)
        record += name_padded
        record += struct.pack("<BB", 1, 1)  # yourTelemetry, showOnlineNames
        body.extend(record)

    return header + bytes(body)


def run(host: str, port: int, hz: int = 20):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print(f"╔{'═'*50}╗")
    print(f"║  F1 25 UDP Telemetry Simulator                   ║")
    print(f"║  Target : {host}:{port:<29}║")
    print(f"║  Rate   : {hz} Hz  ({TOTAL_LAPS} laps, {CAR_COUNT} cars)           ║")
    print(f"╚{'═'*50}╝")
    print("Sending packets... (Ctrl+C to stop)\n")

    frame = 0
    session_time = 0.0
    interval = 1.0 / hz
    sent = 0
    start = time.time()

    # Send session start event
    sock.sendto(make_event_packet(frame, session_time, "SSTA"), (host, port))
    sent += 1
    sock.sendto(make_participants_packet(frame, session_time), (host, port))
    sent += 1

    try:
        while True:
            lap_frac = session_time / 85.0  # ~85s per lap
            current_lap = min(TOTAL_LAPS, int(lap_frac) + 1)
            lap_progress = lap_frac % 1.0

            if current_lap > TOTAL_LAPS:
                sock.sendto(make_event_packet(frame, session_time, "SEND"), (host, port))
                print(f"\n✓ Race complete! Sent {sent} packets in {time.time()-start:.1f}s")
                break

            # Send a cycle of different packet types each tick
            packets = [
                make_session_packet(frame, session_time),
                make_motion_packet(frame, session_time, lap_progress),
                make_lap_data_packet(frame, session_time, current_lap),
                make_car_telemetry_packet(frame, session_time),
                make_car_status_packet(frame, session_time, current_lap),
            ]

            if frame % max(1, hz * 2) == 0:
                packets.insert(0, make_participants_packet(frame, session_time))

            for pkt in packets:
                sock.sendto(pkt, (host, port))
                sent += 1

            frame += 1
            session_time += interval

            if frame % (hz * 5) == 0:  # Every 5 seconds
                elapsed = time.time() - start
                print(f"  Lap {current_lap}/{TOTAL_LAPS} | Frame {frame} | Sent {sent} pkts | {elapsed:.0f}s elapsed")

            time.sleep(interval)

    except KeyboardInterrupt:
        print(f"\n⏹ Stopped. Sent {sent} packets in {time.time()-start:.1f}s")
    finally:
        sock.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="F1 25 UDP telemetry simulator")
    parser.add_argument("--host", default="127.0.0.1", help="Target host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=20777, help="Target port (default: 20777)")
    parser.add_argument("--hz", type=int, default=20, help="Packet rate in Hz (default: 20)")
    args = parser.parse_args()
    run(args.host, args.port, args.hz)
