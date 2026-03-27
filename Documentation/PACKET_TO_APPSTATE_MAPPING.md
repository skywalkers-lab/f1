# Packet to AppState Mapping

이 문서는 UDP 패킷이 local-bridge의 AppState로 어떻게 반영되는지 정의한다.

## Single Source of Truth

- Packet ID/이름/최소 크기: packages/shared-protocol/src/udpProtocol.js
- Header 파싱: packages/shared-protocol/src/udpProtocol.js
- Frame 집계/health: packages/shared-protocol/src/frameAggregator.js
- Packet 파싱: local-bridge/src/f1udpParser.js
- 상태 반영: local-bridge/src/appStateBuilder.js

## Header -> Global State

- header.packetFormat -> packet_format
- header.packetVersion -> packet_version
- header.sessionUID -> session_uid
- header.frameIdentifier -> last_frame_identifier
- header.playerCarIndex -> player_car_index, minimap.player_car_index

## Raw Layer Preservation

모든 수신 패킷은 아래 형태로 raw 계층에 보존된다.

- raw.last_packets_by_type[type]: 최신 메타데이터
- raw.latest_packet_payloads[type]: 최신 원본 payload(base64)
- raw.recent_packets[]: 최근 수신 인덱스(최대 120개)

## Derived/View Mapping

### Session Packet

- sessionType -> session_type
- trackId -> track
- weather -> weather_state
- totalLaps -> total_laps
- safetyCarStatus -> race_control_state
- track -> minimap.drs_zones

### Lap Data Packet

- carPosition/currentLapNum/lastLapMs/currentLapMs -> player, leaderboard, pace
- pitStatus -> leaderboard.is_pitting
- penalties/warnings -> player penalty fields

### Car Telemetry Packet

- speed/throttle/brake/gear/rpm/drs -> player, minimap.cars

### Car Status Packet

- tyreCompoundVisual/tyreCompoundRaw -> player.tyre_compound, leaderboard.tyre_compound
- fuelInTank -> player.fuel
- ersStoreEnergy -> player.ers

### Participants Packet

- name -> leaderboard.driver_code(3글자 코드)

### Motion Packet

- x/z/vx/vz -> minimap.cars, minimap.track_trace

## Feed Health

- frameAggregator.snapshot() -> state.feed_health
- health.scorePct -> ingest_stats.feed_health_score_pct
- health score/band/coverage/jitter -> derived.telemetry_feed

## Size Validation

- validatePacketSize(packetId, byteLength)
- 실패 누적: ingest_stats.size_validation_failures
