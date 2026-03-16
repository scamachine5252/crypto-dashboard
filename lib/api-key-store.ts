import type { ApiKeyConfig, ExchangeId } from './types'

const NS = 'nexus:apikeys'

function key(exchangeId: ExchangeId): string {
  return `${NS}:${exchangeId}`
}

// TODO: AES-encrypt with session-derived key before storing in production
export function loadApiKey(exchangeId: ExchangeId): ApiKeyConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key(exchangeId))
    return raw ? (JSON.parse(raw) as ApiKeyConfig) : null
  } catch {
    return null
  }
}

export function saveApiKey(config: ApiKeyConfig): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(key(config.exchangeId), JSON.stringify(config))
}

export function removeApiKey(exchangeId: ExchangeId): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(key(exchangeId))
}

export function loadAllApiKeys(): Partial<Record<ExchangeId, ApiKeyConfig>> {
  const result: Partial<Record<ExchangeId, ApiKeyConfig>> = {}
  for (const id of ['binance', 'bybit', 'okx'] as ExchangeId[]) {
    const config = loadApiKey(id)
    if (config) result[id] = config
  }
  return result
}
