import type { IpcError, IpcResult } from '../../../shared/ipc/contracts'

export const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred.'
export const NO_BRIDGE_MESSAGE = 'The desktop bridge is not available. Restart ClashForge.'

/**
 * What the player sees for a failed request. Expected errors carry a message
 * written for people by the service; INTERNAL_ERROR never exposes details.
 */
export function toUserMessage(error: IpcError | 'no-bridge' | unknown): string {
  if (error === 'no-bridge') return NO_BRIDGE_MESSAGE
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const { code, message } = error as IpcError
    if (code === 'INTERNAL_ERROR' || typeof message !== 'string' || message.trim() === '') return GENERIC_ERROR_MESSAGE
    if (code === 'FORBIDDEN') return GENERIC_ERROR_MESSAGE
    return message
  }
  // A rejected promise or thrown value: never shown verbatim.
  return GENERIC_ERROR_MESSAGE
}

export function resultError<T>(result: IpcResult<T>): string | null {
  return result.ok ? null : toUserMessage(result.error)
}
