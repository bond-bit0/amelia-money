import { useMemo, useState } from 'react'
import { rpc } from './supabase'
import { money, toCents, dateShort, todayISO, STATUS_LABEL } from './format'
import { Modal, Field, ErrorText, useAction, Empty } from './ui'
import { LoanChart } from './LoanChart'
import { children } from './Home'
import { paymentFor, countFor, countUntil, buildSchedule } from './loanMath'

export function Loans({ data }) {
  const isParent = data.me.role === 'parent'
  const mine = isParent ? data.loans : data.loans.filter((l) => l.child_id === data.me.user_id)
  const [sel, setSel] = useState(mine[0]?.id)
  const [newLoan, setNewLoan] = useState(false)
  const loan = mine.find((l) => l.id === sel) || mine[0]
  return (
    <>
      {(mine.length > 1 || isParent) && (
        <div className="chips">
          {mine.map((l) => <button key={l.id} className={'chip' + (l.id === loan?.id ? ' on' : '')} onClick={() => setSel(l.id)}>{l.name}{l.status !== 'active' ? ` (${l.status.replace('_', ' ')})` : ''}</button>)}
          {isParent && <button className="chip add" onClick={() => setNewLoan(true)}>+ New loan</button>}
        </div>
      )}
      {!loan && <section className="card"><Empty>No loans yet.</Empty>{isParent && children(data).length === 0 && <p className="muted">Invite Amelia first in Settings.</p>}</section>}
      {loan && <LoanDetail key={loan.id} data={data} loan={loan} />}
      {newLoan && <NewLoanModal data={data} onClose={(id) => { setNewLoan(false); if (id) setSel(id) }} />}
    </>
  )
}

function LoanDetail({ data, loan }) {
  const isParent = data.me.role === 'parent'
  const [modal, setModal] = useState(null)
  const rows = data.schedule.filter((s) => s.loan_id === loan.id)
  const reversed = new Set(data.entries.filter((e) => e.reverses_entry_id).map((e) => e.reverses_entry_id))
  const payEntries = data.entries.filter((e) => e.loan_id === loan.id && e.status === 'approved' && ['loan_payment', 'repo_sale'].includes(e.type) && !reversed.has(e.id))
  const payments = payEntries.map((e) => ({ amt: Math.abs(e.amount_cents), d: e.occurred_on }))
  const pendingPay = data.entries.filter((e) => e.loan_id === loan.id && e.status === 'pending')
  const total = rows.reduce((a, s) => a + s.payment_cents, 0)
  const paid = rows.reduce((a, s) => a + s.paid_cents, 0)
  const due = rows.filter((s) => s.status !== 'upcoming' || s.paid_cents >= s.payment_cents)
  const onTime = rows.filter((s) => s.status === 'on_time').length
  const strikes = rows.filter((s) => s.struck_at).length
  const next = rows.find((s) => s.paid_cents < s.payment_cents)
  const late = rows.filter((s) => s.struck_at || ['late', 'missed', 'partial'].includes(s.status) && s.days_late)
  const hasInterest = Number(loan.apr) > 0
  const interestPaid = rows.reduce((a, s) => a + Math.min(s.interest_cents, s.paid_cents), 0)
  const atLimit = strikes >= loan.strike_limit

  return (
    <>
      {atLimit && loan.status === 'active' && (
        <section className="card alarm">
          <h2>Strike {strikes} of {loan.strike_limit}</h2>
          <p>The {loan.name} gets repossessed and sold. The money from the sale goes against what is left on the loan.</p>
          {isParent && <button className="btn danger big" onClick={() => setModal('repo')}>Record the sale</button>}
        </section>
      )}
      <section className="card">
        <div className="row-between"><h2>{loan.name}</h2><span className={'strikes s' + Math.min(strikes, 3)}>{strikes} of {loan.strike_limit} strikes</span></div>
        <div className="stats">
          <div><span>Left to pay</span><strong>{money(total - paid)}</strong></div>
          <div><span>Paid</span><strong>{money(paid)}</strong></div>
          <div><span>On time</span><strong>{onTime} of {due.length}</strong></div>
          {hasInterest && <div><span>Interest paid</span><strong>{money(interestPaid)}</strong></div>}
        </div>
        <p className="muted">
          Borrowed {money(loan.principal_cents)}{hasInterest ? ` at ${(loan.apr * 100).toFixed(2).replace(/\.00$/, '')}% a year` : ', no interest'} ·
          {' '}{rows.length} {loan.frequency === 'biweekly' ? 'every-2-week' : loan.frequency} payments of {money(loan.payment_cents)}
          {loan.status !== 'active' && <> · <strong>{loan.status.replace('_', ' ')}</strong></>}
        </p>
        {next && <p className="next-due">Next: <strong>{money(next.payment_cents - next.paid_cents)}</strong> due {dateShort(next.due_date)}{next.status === 'missed' || next.status === 'partial' ? ` (${next.days_late} days late)` : ''}</p>}
        {total - paid > 0 && (
          <div className="actions-row">
            <button className="btn primary big" onClick={() => setModal('pay')}>{isParent ? 'Record payment' : 'Make a payment'}</button>
            {isParent && !atLimit && loan.status === 'active' && <button className="btn" onClick={() => setModal('repo')}>Repossess</button>}
          </div>
        )}
        {pendingPay.length > 0 && <p className="muted">{pendingPay.length} payment waiting for a parent: {pendingPay.map((e) => money(-e.amount_cents)).join(', ')}</p>}
      </section>

      <section className="card">
        <h2>Balance over time</h2>
        <LoanChart rows={rows} payments={payments} start={chartStart(loan, rows)} />
      </section>

      <section className="card">
        <h2>Late and missed</h2>
        {late.length === 0 ? <Empty>None. Every payment so far is on time.</Empty> : (
          <ul className="list">{late.map((s) => (
            <li key={s.payment_no} className="late-row">
              <div className="row-between">
                <div><strong>Payment {s.payment_no}</strong> · due {dateShort(s.due_date)}<small>
                  {STATUS_LABEL[s.status]}{s.paid_date ? ` · paid ${dateShort(s.paid_date)}` : ''}{s.days_late ? ` · ${s.days_late} day${s.days_late === 1 ? '' : 's'} late` : ''}{s.struck_at ? ' · strike' : ''}
                </small></div>
                <span>{money(s.paid_cents)} / {money(s.payment_cents)}</span>
              </div>
              {s.parent_note && <p className="note">“{s.parent_note}”</p>}
              {isParent && <button className="btn link" onClick={() => setModal({ note: s })}>{s.parent_note ? 'Edit note' : 'Add note'}</button>}
            </li>
          ))}</ul>
        )}
      </section>

      <section className="card">
        <h2>Payment schedule</h2>
        <div className="table-wrap">
          <table className="sched">
            <thead><tr><th>#</th><th>Due</th><th>Payment</th>{hasInterest && <><th>Interest</th><th>Principal</th></>}<th>Left after</th><th>Status</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.payment_no} className={'st-' + s.status}>
                <td>{s.payment_no}</td><td>{dateShort(s.due_date)}</td><td>{money(s.payment_cents)}</td>
                {hasInterest && <><td>{money(s.interest_cents)}</td><td>{money(s.principal_cents)}</td></>}
                <td>{money(s.balance_after_cents)}</td>
                <td>{STATUS_LABEL[s.status]}{s.status === 'partial' ? ` ${money(s.paid_cents)}` : ''}{s.struck_at ? ' ✕' : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="muted small">✕ = strike. Strikes stay on the record even after the payment is made.</p>
      </section>

      {modal === 'pay' && <PayModal data={data} loan={loan} next={next} onClose={() => setModal(null)} />}
      {modal === 'repo' && <RepoModal data={data} loan={loan} left={total - paid} onClose={() => setModal(null)} />}
      {modal?.note && <NoteModal data={data} loan={loan} row={modal.note} onClose={() => setModal(null)} />}
    </>
  )
}

// Chart starts when the loan was made, or one period before the first payment, whichever is earlier.
function chartStart(loan, rows) {
  const made = loan.created_at.slice(0, 10)
  const first = rows[0]?.due_date || made
  const back = new Date(first + 'T12:00:00')
  back.setDate(back.getDate() - (loan.frequency === 'weekly' ? 7 : loan.frequency === 'biweekly' ? 14 : 30))
  const prior = back.toISOString().slice(0, 10)
  return made < prior ? made : prior
}

function PayModal({ data, loan, next, onClose }) {
  const isParent = data.me.role === 'parent'
  const b = data.balances.find((x) => x.child_id === loan.child_id)
  const [amount, setAmount] = useState(next ? ((next.payment_cents - next.paid_cents) / 100).toFixed(2) : '')
  const [date, setDate] = useState(todayISO())
  const { busy, error, run } = useAction()
  const submit = (e) => {
    e.preventDefault()
    const cents = toCents(amount)
    if (!cents) return
    run(async () => {
      if (isParent) await rpc('parent_entry', { p_child: loan.child_id, p_type: 'loan_payment', p_amount_cents: cents, p_note: `Payment: ${loan.name}`, p_loan: loan.id, p_occurred_on: date })
      else await rpc('submit_request', { p_type: 'loan_payment', p_amount_cents: cents, p_note: `Payment: ${loan.name}`, p_loan: loan.id })
      data.reload(); onClose()
    })
  }
  return (
    <Modal title={isParent ? 'Record payment' : 'Make a payment'} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">Comes out of her credit ({b ? money(b.credit_cents) : '…'}). Extra money pays future payments early.</p>
        <Field label="Amount"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></Field>
        {isParent && <Field label="Paid on" hint="Use the real date. It decides on time or late."><input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} required /></Field>}
        {!isParent && <p className="muted">A parent approves it. It counts from the day you send it.</p>}
        <ErrorText error={error} />
        <button className="btn primary big" disabled={busy}>{isParent ? 'Save payment' : 'Send to a parent'}</button>
      </form>
    </Modal>
  )
}

function RepoModal({ data, loan, left, onClose }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const { busy, error, run } = useAction()
  const submit = (e) => {
    e.preventDefault()
    const cents = toCents(amount)
    if (!cents) return
    run(async () => {
      await rpc('parent_entry', { p_child: loan.child_id, p_type: 'repo_sale', p_amount_cents: Math.min(cents, left), p_note: note || `Sold ${loan.name}`, p_loan: loan.id })
      data.reload(); onClose()
    })
  }
  return (
    <Modal title={`Repossess ${loan.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p>Enter what the {loan.name} sold for. It pays down the {money(left)} left. It does not touch her credit. Anything still owed stays on the loan.</p>
        <Field label="Sale price"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></Field>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sold on Marketplace" /></Field>
        <ErrorText error={error} />
        <button className="btn danger big" disabled={busy}>Record sale and repossess</button>
      </form>
    </Modal>
  )
}

function NoteModal({ data, loan, row, onClose }) {
  const [note, setNote] = useState(row.parent_note || '')
  const { busy, error, run } = useAction()
  return (
    <Modal title={`Note on payment ${row.payment_no}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc('set_schedule_note', { p_loan: loan.id, p_payment_no: row.payment_no, p_note: note || null }); data.reload(); onClose() }) }}>
        <p className="muted">The late record itself can't be erased. A note explains it.</p>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
        <ErrorText error={error} />
        <button className="btn primary big" disabled={busy}>Save note</button>
      </form>
    </Modal>
  )
}

function NewLoanModal({ data, onClose }) {
  const kids = children(data)
  const [f, setF] = useState({
    child: kids[0]?.user_id, name: '', principal: '', apr: '0', frequency: 'monthly', mode: 'count',
    count: '12', payoff: '', payment: '', first: todayISO(), strikes: '3', credit: false,
  })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const { busy, error, run } = useAction()

  const preview = useMemo(() => {
    const P = toCents(f.principal)
    const apr = Number(f.apr || 0) / 100
    if (!P || !f.first || !(apr >= 0)) return null
    let n, pay
    if (f.mode === 'payment') {
      pay = toCents(f.payment); if (!pay) return null
      n = countFor(P, apr, f.frequency, pay); if (!n) return { error: 'That payment never pays off the loan.' }
    } else {
      n = f.mode === 'count' ? parseInt(f.count, 10) : countUntil(f.first, f.payoff, f.frequency)
      if (!n || n < 1) return null
      pay = paymentFor(P, apr, f.frequency, n)
    }
    const rows = buildSchedule(P, apr, f.frequency, n, pay, f.first)
    return { n, pay, rows, total: rows.reduce((a, r) => a + r.payment_cents, 0), P }
  }, [f])

  const submit = (e) => {
    e.preventDefault()
    if (!preview || preview.error) return
    run(async () => {
      const id = await rpc('create_loan', {
        p_child: f.child, p_name: f.name.trim(), p_principal_cents: preview.P, p_apr: Number(f.apr || 0) / 100,
        p_frequency: f.frequency, p_num_payments: preview.n, p_first_due: f.first,
        p_payment_cents: f.mode === 'payment' ? preview.pay : null, p_strike_limit: parseInt(f.strikes, 10) || 3, p_credit_child: f.credit,
      })
      await data.reload(); onClose(id)
    })
  }

  return (
    <Modal title="New loan" onClose={() => onClose()}>
      <form onSubmit={submit}>
        {kids.length > 1 && <Field label="For"><select value={f.child} onChange={set('child')}>{kids.map((k) => <option key={k.user_id} value={k.user_id}>{k.display_name}</option>)}</select></Field>}
        <Field label="What does it buy?"><input value={f.name} onChange={set('name')} placeholder="Bike" required /></Field>
        <Field label="Amount borrowed"><input inputMode="decimal" value={f.principal} onChange={set('principal')} placeholder="$300" required /></Field>
        <Field label="Interest per year (%)" hint="0 for no interest"><input inputMode="decimal" value={f.apr} onChange={set('apr')} /></Field>
        <Field label="How often"><select value={f.frequency} onChange={set('frequency')}><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option></select></Field>
        <Field label="First payment due"><input type="date" value={f.first} min={todayISO()} onChange={set('first')} required /></Field>
        <Field label="Set the length by">
          <select value={f.mode} onChange={set('mode')}><option value="count">Number of payments</option><option value="payoff">Payoff date</option><option value="payment">Payment amount</option></select>
        </Field>
        {f.mode === 'count' && <Field label="Number of payments"><input inputMode="numeric" value={f.count} onChange={set('count')} /></Field>}
        {f.mode === 'payoff' && <Field label="Paid off by"><input type="date" value={f.payoff} min={f.first} onChange={set('payoff')} /></Field>}
        {f.mode === 'payment' && <Field label="Each payment"><input inputMode="decimal" value={f.payment} onChange={set('payment')} placeholder="$25" /></Field>}
        <Field label="Strikes before repossession"><input inputMode="numeric" value={f.strikes} onChange={set('strikes')} /></Field>
        <label className="check"><input type="checkbox" checked={f.credit} onChange={set('credit')} /> Add the loan money to her credit (leave off if you bought the item yourself)</label>

        {preview?.error && <p className="error">{preview.error}</p>}
        {preview && !preview.error && (
          <div className="preview">
            <strong>{preview.n} payments of {money(preview.pay)}</strong>
            <span>Last one {money(preview.rows.at(-1).payment_cents)} on {dateShort(preview.rows.at(-1).due_date)}</span>
            {preview.total > preview.P && <span>Total interest {money(preview.total - preview.P)}</span>}
          </div>
        )}
        <ErrorText error={error} />
        <button className="btn primary big" disabled={busy || !preview || preview.error}>Create loan</button>
      </form>
    </Modal>
  )
}

