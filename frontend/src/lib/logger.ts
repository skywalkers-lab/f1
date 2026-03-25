/**
 * Lightweight structured logger for the frontend.
 *
 * Provides levelled logging with optional structured metadata.
 * In production builds only warnings and errors are emitted.
 */

import { IS_PROD } from './env'

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
}

const minLevel: LogLevel = IS_PROD ? LogLevel.WARN : LogLevel.DEBUG

type LogMeta = Record<string, unknown>

function emit(level: LogLevel, tag: string, msg: string, meta?: LogMeta): void {
  if (level < minLevel) return

  const entry = {
    ts: new Date().toISOString(),
    level: LEVEL_NAMES[level],
    tag,
    msg,
    ...(meta ? { meta } : {}),
  }

  switch (level) {
    case LogLevel.ERROR:
      console.error(`[${entry.tag}] ${entry.msg}`, meta ?? '')
      break
    case LogLevel.WARN:
      console.warn(`[${entry.tag}] ${entry.msg}`, meta ?? '')
      break
    case LogLevel.INFO:
      console.info(`[${entry.tag}] ${entry.msg}`, meta ?? '')
      break
    default:
      console.debug(`[${entry.tag}] ${entry.msg}`, meta ?? '')
  }
}

export interface Logger {
  debug(msg: string, meta?: LogMeta): void
  info(msg: string, meta?: LogMeta): void
  warn(msg: string, meta?: LogMeta): void
  error(msg: string, meta?: LogMeta): void
}

export function createLogger(tag: string): Logger {
  return {
    debug: (msg, meta) => emit(LogLevel.DEBUG, tag, msg, meta),
    info: (msg, meta) => emit(LogLevel.INFO, tag, msg, meta),
    warn: (msg, meta) => emit(LogLevel.WARN, tag, msg, meta),
    error: (msg, meta) => emit(LogLevel.ERROR, tag, msg, meta),
  }
}
