export type RoomRole = 'driver' | 'engineer' | 'spectator'

export type CreateRoomRequest = {
  roomId: string
  password: string
  hostDriverId: string
}

export type JoinRoomRequest = {
  roomId: string
  password: string
  role: RoomRole
  clientId: string
}

export type RoomAuthResponse = {
  ok: boolean
  roomId: string
  role: RoomRole
  clientId: string
  authToken: string
  expiresInMs: number
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await res.json()
  if (!res.ok) {
    throw new Error(payload?.error || `Request failed (${res.status})`)
  }
  return payload as T
}

export async function createRoom(apiBase: string, req: CreateRoomRequest): Promise<RoomAuthResponse> {
  return postJson<RoomAuthResponse>(`${apiBase}/api/rooms/create`, req)
}

export async function joinRoom(apiBase: string, req: JoinRoomRequest): Promise<RoomAuthResponse> {
  return postJson<RoomAuthResponse>(`${apiBase}/api/rooms/join`, req)
}

export async function refreshRoomAuth(apiBase: string, authToken: string): Promise<{ authToken: string; expiresInMs: number }> {
  const payload = await postJson<{ ok: boolean; authToken: string; expiresInMs: number }>(
    `${apiBase}/api/auth/refresh`,
    { authToken },
  )
  return {
    authToken: payload.authToken,
    expiresInMs: payload.expiresInMs,
  }
}

export type StructuredCommand = {
  type: 'BOX' | 'PUSH' | 'SAVE' | 'TYRE' | 'INFO'
  priority: 'critical' | 'high' | 'normal'
  message: string
  timestamp: number
  ttlMs?: number
  idempotencyKey?: string
}

export function createRelayWsUrl(baseWsUrl: string, args: {
  roomId: string
  role: RoomRole
  clientId: string
  authToken: string
  encoding?: 'msgpack' | 'json'
}): string {
  const u = new URL(baseWsUrl)
  u.searchParams.set('role', 'viewer')
  u.searchParams.set('viewerRole', args.role)
  u.searchParams.set('sessionId', args.roomId)
  u.searchParams.set('clientId', args.clientId)
  u.searchParams.set('auth', args.authToken)
  u.searchParams.set('encoding', args.encoding || 'msgpack')
  return u.toString()
}
