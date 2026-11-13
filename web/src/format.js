export function money(cents, { sign = false } = {}) {
  const n = Math.abs(cents || 0) / 100
  const s = n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  if (cents < 0) return '-' + s
  return (sign && cents > 0 ? '+' : '') + s
}

// "12.50" or "$12.50" -> 1250
export function toCents(text) {
  const n = Number(String(text).replace(/[$,\s]/g, ''))
  if (!isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

export function dateShort(d) {
  const dt = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00') : new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function dateTime(d) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function until(ts, now = Date.now()) {
  let s = Math.max(0, Math.round((new Date(ts).getTime() - now) / 1000))
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.floor(s / 60); s -= m * 60
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${s}s`
  return `${s}s`
}

export function todayISO() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export const TYPE_LABEL = {
  chore: 'Chore', schoolwork: 'Schoolwork', activity: 'Activity', task: 'Task',
  gift: 'Gift', business: 'Business income', purchase: 'Purchase', cash_out: 'Cash out',
  loan_disbursement: 'Loan money', loan_payment: 'Loan payment', repo_sale: 'Repossession sale',
  adjustment: 'Adjustment', reversal: 'Reversal',
}

export const STATUS_LABEL = { upcoming: 'Upcoming', on_time: 'On time', late: 'Late', partial: 'Partial', missed: 'Missed' }
