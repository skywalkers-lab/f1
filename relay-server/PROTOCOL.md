# Multiplayer Pit Wall Protocol (v1)

This protocol is used between driver client, session server, and engineer clients.

## Transport

- WebSocket endpoint: `/ws`
- Recommended query params for WS: `?sessionId=<roomId>&auth=<jwt>&viewerRole=<driver|engineer|spectator>`
- JSON payloads only for v1

## Common Envelope Fields

All real-time payloads include:

- `version`: protocol version (number, currently `1`)
- `sessionId`: room id
- `ts`: unix epoch milliseconds (server timestamp)
- `sourceClientId`: sender client id

## Telemetry

### Driver -> Server

```json
{
  "type": "telemetry_snapshot",
  "version": 1,
  "sessionId": "room-abc",
  "seq": 123,
  "ts": 1740000000000,
  "sourceClientId": "driver-1",
  "payload": { "player": { "lap": 12 } }
}
```

### Server -> Engineers/Driver

```json
{
  "type": "state",
  "version": 1,
  "eventId": 982,
  "sessionId": "room-abc",
  "payload": { "player": { "lap": 12 } },
  "meta": {
    "seq": 123,
    "source": "driver-1",
    "ts": 1740000000000,
    "eventId": 982
  }
}
```

## Commands

### Engineer -> Server

```json
{
  "type": "command_submit",
  "version": 1,
  "sessionId": "room-abc",
  "sourceClientId": "eng-2",
  "command": {
    "idempotencyKey": "e9aa4a46-26a7-4454-8682-f1f8a29452be",
    "type": "BOX",
    "priority": "critical",
    "message": "BOX THIS LAP",
    "timestamp": 1740000000123,
    "ttlMs": 3000
  }
}
```

### Server -> Driver

```json
{
  "type": "driver_command",
  "version": 1,
  "sessionId": "room-abc",
  "sourceClientId": "eng-2",
  "command": {
    "id": "cmd_9c2a2f23",
    "type": "BOX",
    "priority": "critical",
    "message": "BOX THIS LAP",
    "timestamp": 1740000000123,
    "ttlMs": 3000
  }
}
```

### Driver -> Server ACK

```json
{
  "type": "command_ack",
  "version": 1,
  "sessionId": "room-abc",
  "sourceClientId": "driver-1",
  "commandId": "cmd_9c2a2f23",
  "status": "received",
  "timestamp": 1740000000456
}
```

### Server -> Engineers ACK fanout

```json
{
  "type": "command_ack",
  "version": 1,
  "sessionId": "room-abc",
  "commandId": "cmd_9c2a2f23",
  "status": "received",
  "timestamp": 1740000000456
}
```

## Session APIs

### Create room

`POST /api/rooms/create`

Body:

```json
{
  "roomId": "race-2026-03-24",
  "password": "super-secret",
  "hostDriverId": "driver-1"
}
```

### Join room

`POST /api/rooms/join`

Body:

```json
{
  "roomId": "race-2026-03-24",
  "password": "super-secret",
  "role": "engineer",
  "clientId": "eng-2"
}
```

Response contains `authToken` (short-lived JWT).

## Notes

- Server never mutates telemetry semantics; it only relays state.
- Driver role is the only telemetry authority for a room.
- Commands are structured and validated server-side.
