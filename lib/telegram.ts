export async function sendTelegramAlert(message: string): Promise<void> {
  const token   = process.env.TELEGRAM_BOT_TOKEN
  const chat_id = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat_id) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id, text: message, parse_mode: 'HTML' }),
  })
}

export function formatAlertMessage(params: {
  accountName:    string
  exchange:       string
  ruleType:       string
  currentValue:   number
  alertThreshold: number
  severity:       'warning' | 'critical'
  killThreshold?: number | null
  suspended?:     boolean
}): string {
  const { accountName, exchange, ruleType, currentValue, alertThreshold, severity, killThreshold, suspended } = params
  const label = ruleType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const date  = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

  if (severity === 'critical' && suspended) {
    return [
      `🔴 <b>KILL SWITCH — ${accountName} (${exchange})</b>`,
      `Rule: ${label}`,
      `Current: ${currentValue.toFixed(2)} | Kill: ${killThreshold?.toFixed(2)}`,
      `Account SUSPENDED — revoke API key manually on exchange.`,
      date,
    ].join('\n')
  }

  return [
    `⚠️ <b>RISK ALERT — ${accountName} (${exchange})</b>`,
    `Rule: ${label}`,
    `Current: ${currentValue.toFixed(2)} | Alert: ${alertThreshold.toFixed(2)}`,
    date,
  ].join('\n')
}
