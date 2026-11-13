import { money, dateShort } from './format'

// Scheduled "left to pay" line vs actual, built from the schedule rows and approved payments.
export function LoanChart({ rows, payments, start }) {
  if (!rows.length) return null
  const total = rows.reduce((a, r) => a + r.payment_cents, 0)
  const t = (iso) => new Date(iso + 'T12:00:00').getTime()
  const t0 = t(start)
  const t1 = Math.max(t(rows[rows.length - 1].due_date), Date.now())
  const W = 340, H = 180, L = 46, R = 10, T = 10, B = 26
  const x = (ms) => L + ((ms - t0) / (t1 - t0 || 1)) * (W - L - R)
  const y = (c) => T + (1 - c / (total || 1)) * (H - T - B)

  // scheduled: steps down on each due date
  let left = total
  let sched = `M${x(t0)},${y(left)}`
  for (const r of rows) { sched += ` H${x(t(r.due_date))}`; left -= r.payment_cents; sched += ` V${y(left)}` }

  // actual: steps down on each payment date, runs to today
  let a = total
  let actual = `M${x(t0)},${y(a)}`
  for (const p of [...payments].sort((p1, p2) => p1.d.localeCompare(p2.d))) {
    actual += ` H${x(t(p.d))}`; a = Math.max(0, a - p.amt); actual += ` V${y(a)}`
  }
  actual += ` H${x(Math.min(Date.now(), t1))}`

  const ticks = [0, 0.5, 1].map((f) => Math.round(total * f))
  const today = x(Date.now())
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Loan balance over time">
        {ticks.map((c) => (
          <g key={c}><line x1={L} x2={W - R} y1={y(c)} y2={y(c)} className="grid" /><text x={L - 6} y={y(c) + 4} className="axis" textAnchor="end">{money(c).replace('.00', '')}</text></g>
        ))}
        <text x={L} y={H - 8} className="axis">{dateShort(start)}</text>
        <text x={W - R} y={H - 8} className="axis" textAnchor="end">{dateShort(new Date(t1).toISOString().slice(0, 10))}</text>
        {today > L && today < W - R && <line x1={today} x2={today} y1={T} y2={H - B} className="today" />}
        <path d={sched} className="line sched" />
        <path d={actual} className="line actual" />
      </svg>
      <figcaption><span className="key sched" /> Plan <span className="key actual" /> Actual (left to pay)</figcaption>
    </figure>
  )
}
