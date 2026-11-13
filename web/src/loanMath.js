// Mirrors the database's schedule math so the setup form can preview it.
export const PER_YEAR = { weekly: 52, biweekly: 26, monthly: 12 }

export function addPeriod(iso, freq, n) {
  const d = new Date(iso + 'T12:00:00')
  if (freq === 'weekly') d.setDate(d.getDate() + 7 * n)
  else if (freq === 'biweekly') d.setDate(d.getDate() + 14 * n)
  else {
    const day = d.getDate()
    d.setDate(1); d.setMonth(d.getMonth() + n)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(day, last))
  }
  return d.toISOString().slice(0, 10)
}

export function paymentFor(principal, apr, freq, n) {
  const r = apr / PER_YEAR[freq]
  if (r === 0) return Math.ceil(principal / n)
  return Math.ceil((r * principal) / (1 - Math.pow(1 + r, -n)))
}

export function countFor(principal, apr, freq, pay) {
  const r = apr / PER_YEAR[freq]
  let bal = principal, n = 0
  while (bal > 0) {
    const int = Math.round(bal * r)
    if (pay <= int) return null
    bal = bal + int - pay; n++
    if (n > 520) return null
  }
  return n
}

// number of payments from first due date to payoff date, inclusive
export function countUntil(first, payoff, freq) {
  if (!first || !payoff || payoff < first) return null
  let n = 1
  while (addPeriod(first, freq, n) <= payoff && n < 520) n++
  return n
}

export function buildSchedule(principal, apr, freq, n, pay, first) {
  const r = apr / PER_YEAR[freq]
  const rows = []
  let bal = principal
  for (let i = 1; i <= n && bal > 0; i++) {
    const int = Math.round(bal * r)
    let p = pay
    if (i === n || p >= bal + int) p = bal + int
    bal -= p - int
    rows.push({ payment_no: i, due_date: addPeriod(first, freq, i - 1), payment_cents: p, interest_cents: int, principal_cents: p - int, balance_after_cents: bal })
  }
  return rows
}
