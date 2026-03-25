import { useCallback } from 'react'
import type { StructuredCommand } from '../lib/multiplayerSession'

type SocketRef = { current: WebSocket | null }

export function useEngineerCommands(socketRef: SocketRef, sessionId: string, clientId: string) {
  const submitCommand = useCallback((command: StructuredCommand) => {
    const ws = socketRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }

    const payload = {
      type: 'command_submit',
      version: 1,
      sessionId,
      sourceClientId: clientId,
      command: {
        ...command,
        timestamp: command.timestamp || Date.now(),
      },
    }
    ws.send(JSON.stringify(payload))
  }, [clientId, sessionId, socketRef])

  return {
    submitCommand,
  }
}
