# F1 25 Pitwall Rebuild Blueprint

이 문서는 기존 코드베이스를 **패키지 경계가 명확한 생산형 구조**로 재정렬하기 위한 기준이다.

## Target package layout

```text
apps/
  driver-desktop/      # Electron shell + UDP ingest + overlay window
  engineer-web/        # React tactical dashboard
  relay-server/        # WS rooms/auth/command relay only
packages/
  udp-spec/            # 공식 EA F1 25 구조체/offset/size 단일 진실 소스
  telemetry-core/      # parser + frame aggregator + AppState(raw/view)
  strategy-engine/     # worker-safe Monte Carlo + risk scoring
  command-protocol/    # typed command schema + TTL/priority rules
  replay-kit/          # capture format + index + seek/replay
  ui-contracts/        # AppState->UI mapping contracts
```

## Layer contract

1. `udp-spec`: packet id, field offset, field type, packet byte size.
2. `telemetry-core/raw`: lossless packet record (header + payload + checksum).
3. `telemetry-core/view`: tower/gap/tyre/traffic/pit-delta/health score derived models.
4. `strategy-engine`: pure input/output (AppState snapshot in, recommendations out).
5. `apps/*`: view and transport only.

## Immediate hardening tasks

- Shared protocol 패키지에 command/ws/frame aggregator를 단일 구현으로 통합.
- UDP header 파서의 little-endian 해석 경로를 테스트로 고정.
- Telemetry feed health score를 duplicate/gap/out-of-order 기반으로 표준화.
- Room relay 서버는 계산 로직을 제거하고 role/room ACL만 책임지게 분리.

## Packet-to-AppState mapping maintenance

- packet spec 업데이트 시 `udp-spec`에서 JSON schema export.
- `telemetry-core`가 schema 버전을 기록하고 replay 파일 헤더에 포함.
- dashboard는 schema version mismatch 경고를 노출.

## Non-goals

- relay 서버가 telemetry를 재가공하거나 전략 결과를 authoritative로 재작성하지 않음.
- UI 컴포넌트가 raw packet parsing을 직접 수행하지 않음.
