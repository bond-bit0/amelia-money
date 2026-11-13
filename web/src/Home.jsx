import { useState } from 'react'
import { rpc } from './supabase'
import { money, toCents, until, dateTime, TYPE_LABEL } from './format'
import { Modal, Field, ErrorText, useAction, useNow, Empty } from './ui'

export function children(data) {
  return data.members.filter((m) => m.role === 'child')
}

function BalanceCards({ b, name }) {
  if (!b) return null
  return (
    <section className="balances">
      {name && <h2 className="kid-name">{name}</h2>}
      <div className="bal-row">
        <div className="bal credit"><span>Credit</span><strong>{money(b.credit_cents)}</strong><small>Everything you own</small></div>
        <div className="bal avail"><span>Available</span><strong>{money(b.available_cents)}</strong>
          <small>{b.reserved_cents > 0 ? `${money(b.reserved_cents)} saved for your loan` : 'Free to spend'}</small></div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- child

export function ChildHome({ data, go }) {
  const b = data.balances.find((x) => x.child_id === data.me.user_id)
  const [ask, setAsk] = useState(false)
  const pending = data.entries.filter((e) => e.status === 'pending' && e.child_id === data.me.user_id)
  const loan = data.loans.find((l) => l.status === 'active' && l.child_id === data.me.user_id)
  return (
    <>
      <BalanceCards b={b} />
      <ChoreList data={data} />
      <section className="card">
        <div className="row-between"><h2>Ask a parent</h2></div>
        <p className="muted">Got a gift, made a sale, or want to buy something? Send it to a parent.</p>
        <button className="btn primary big" onClick={() => setAsk(true)}>Ask a parent</button>
        {pending.length > 0 && <>
          <h3>Waiting for a yes</h3>
          <ul className="list">{pending.map((e) => <EntryRow key={e.id} e={e} />)}</ul>
        </>}
      </section>
      {loan && <LoanMini data={data} loan={loan} go={go} />}
      {ask && <AskModal data={data} onClose={() => setAsk(false)} />}
    </>
  )
}

function ChoreList({ data }) {
  const now = useNow(1000)
  const { busy, error, run } = useAction()
  const [flash, setFlash] = useState(null)
  const visible = data.chores.filter((c) => c.active && (c.type !== 'task' || new Date(c.expires_at).getTime() > now))
  const tasks = visible.filter((c) => c.type === 'task')
  const standing = visible.filter((c) => c.type !== 'task')
  const claim = (c) => run(async () => {
    await rpc('claim_chore', { p_chore: c.id })
    setFlash(`+${money(c.amount_cents)} for ${c.name}!`)
    setTimeout(() => setFlash(null), 2500)
    data.reload()
  })
  const btn = (c) => {
    const next = c.next_available && new Date(c.next_available).getTime()
    const waiting = c.next_available === 'infinity' || (next && next > now)
    return (
      <button className="btn claim" disabled={busy || waiting} onClick={() => claim(c)}>
        {waiting ? (c.next_available === 'infinity' ? 'Done' : `Again in ${until(next, now)}`) : `Claim +${money(c.amount_cents)}`}
      </button>
    )
  }
  return (
    <section className="card">
      <h2>Jobs</h2>
      {flash && <p className="flash">{flash}</p>}
      <ErrorText error={error} />
      {tasks.length > 0 && <ul className="list">
        {tasks.map((c) => (
          <li key={c.id} className="chore task">
            <div><strong>{c.name}</strong><small className="countdown">Ends in {until(c.expires_at, now)}</small></div>
            {btn(c)}
          </li>
        ))}
      </ul>}
      {standing.length === 0 && tasks.length === 0 && <Empty>No jobs yet. Ask a parent to add some.</Empty>}
      <ul className="list">
        {standing.map((c) => (
          <li key={c.id} className="chore">
            <div><strong>{c.name}</strong><small>{limitText(c)}</small></div>
            {btn(c)}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function limitText(c) {
  const parts = [TYPE_LABEL[c.type]]
  if (c.min_hours_between) parts.push(c.min_hours_between % 24 === 0 ? `once every ${c.min_hours_between / 24} day${c.min_hours_between === 24 ? '' : 's'}` : `once every ${c.min_hours_between} hours`)
  if (c.max_per_day) parts.push(`up to ${c.max_per_day} a day`)
  return parts.join(' · ')
}

function AskModal({ data, onClose }) {
  const [type, setType] = useState('purchase')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const loans = data.loans.filter((l) => l.status === 'active' && l.child_id === data.me.user_id)
  const [loanId, setLoanId] = useState(loans[0]?.id || '')
  const { busy, error, run } = useAction()
  const submit = (e) => {
    e.preventDefault()
    const cents = toCents(amount)
    if (!cents) return
    run(async () => {
      await rpc('submit_request', { p_type: type, p_amount_cents: cents, p_note: note || null, p_loan: type === 'loan_payment' ? loanId : null })
      data.reload(); onClose()
    })
  }
  return (
    <Modal title="Ask a parent" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="What is it?">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="purchase">I want to buy something</option>
            <option value="cash_out">Cash or money on my card</option>
            <option value="gift">I got a gift</option>
            <option value="business">I made money from my business</option>
            {loans.length > 0 && <option value="loan_payment">Make a loan payment</option>}
          </select>
        </Field>
        {type === 'loan_payment' && loans.length > 1 && (
          <Field label="Which loan"><select value={loanId} onChange={(e) => setLoanId(e.target.value)}>{loans.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        )}
        <Field label="Amount"><input inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'gift' ? 'From Grandma' : 'What is it for?'} /></Field>
        <ErrorText error={error} />
        <button className="btn primary big" disabled={busy}>Send</button>
      </form>
    </Modal>
  )
}

function LoanMini({ data, loan, go }) {
  const rows = data.schedule.filter((s) => s.loan_id === loan.id)
  const next = rows.find((s) => s.paid_cents < s.payment_cents)
  const left = rows.reduce((a, s) => a + s.payment_cents - s.paid_cents, 0)
  const strikes = rows.filter((s) => s.struck_at).length
  return (
    <section className="card clickable" onClick={() => go('loan')}>
      <div className="row-between"><h2>Loan: {loan.name}</h2><span className={'strikes s' + Math.min(strikes, 3)}>{strikes} of {loan.strike_limit} strikes</span></div>
      <p><strong>{money(left)}</strong> left to pay</p>
      {next && <p className="muted">Next: {money(next.payment_cents - next.paid_cents)} due {new Date(next.due_date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>}
    </section>
  )
}

// ---------------------------------------------------------------- parent

export function ParentHome({ data, go }) {
  const kids = children(data)
  const [modal, setModal] = useState(null)
  const pending = data.entries.filter((e) => e.status === 'pending')
  const reversed = new Set(data.entries.filter((e) => e.reverses_entry_id).map((e) => e.reverses_entry_id))
  const claims = data.entries.filter((e) => e.chore_id && e.status === 'approved').slice(0, 8)
  const name = (id) => data.members.find((m) => m.user_id === id)?.display_name || ''
  const now = useNow(30000)
  const tasks = data.chores.filter((c) => c.type === 'task' && c.active && new Date(c.expires_at).getTime() > now)

  if (kids.length === 0) {
    return (
      <section className="card">
        <h2>Add Amelia</h2>
        <p>Go to Settings and make an invite code for her. She signs in on her phone and enters the code.</p>
        <button className="btn primary big" onClick={() => go('settings')}>Open Settings</button>
      </section>
    )
  }

  return (
    <>
      <div className="actions">
        <button className="btn primary huge" onClick={() => setModal('purchase')}>Log purchase</button>
        <div className="actions-row">
          <button className="btn big" onClick={() => setModal('task')}>New task</button>
          <button className="btn big" onClick={() => setModal('add')}>Add money</button>
        </div>
      </div>

      {kids.map((k) => <BalanceCards key={k.user_id} b={data.balances.find((b) => b.child_id === k.user_id)} name={kids.length > 1 ? k.display_name : null} />)}

      {pending.length > 0 && (
        <section className="card attention">
          <h2>Needs a yes or no ({pending.length})</h2>
          <ul className="list">{pending.map((e) => <PendingRow key={e.id} e={e} name={name(e.child_id)} reload={data.reload} />)}</ul>
        </section>
      )}

      {tasks.length > 0 && (
        <section className="card">
          <h2>Open tasks</h2>
          <ul className="list">{tasks.map((c) => (
            <li key={c.id} className="row-between"><span>{c.name} · {money(c.amount_cents)}</span><small className="countdown">ends in {until(c.expires_at, now)}</small></li>
          ))}</ul>
        </section>
      )}

      <section className="card">
        <div className="row-between"><h2>Latest claims</h2><button className="btn link" onClick={() => go('activity')}>See all</button></div>
        {claims.length === 0 && <Empty>No claims yet.</Empty>}
        <ul className="list">{claims.map((e) => (
          <li key={e.id} className="entry">
            <div><strong>{e.note}</strong><small>{name(e.child_id)} · {dateTime(e.created_at)}</small></div>
            <div className="entry-right">
              <span className={reversed.has(e.id) ? 'amt struck' : 'amt pos'}>{money(e.amount_cents, { sign: true })}</span>
              {!reversed.has(e.id) && <button className="btn small" onClick={() => setModal({ reverse: e })}>Reverse</button>}
            </div>
          </li>
        ))}</ul>
      </section>

      {modal === 'purchase' && <ParentEntryModal data={data} kind="purchase" onClose={() => setModal(null)} />}
      {modal === 'add' && <ParentEntryModal data={data} kind="add" onClose={() => setModal(null)} />}
      {modal === 'task' && <NewTaskModal data={data} onClose={() => setModal(null)} />}
      {modal?.reverse && <ReverseModal data={data} e={modal.reverse} onClose={() => setModal(null)} />}
    </>
  )
}

function PendingRow({ e, name, reload }) {
  const { busy, error, run } = useAction()
  const [note, setNote] = useState('')
  const decide = (yes) => run(async () => { await rpc('decide_entry', { p_entry: e.id, p_approve: yes, p_note: note || null }); reload() })
  return (
    <li className="pending">
      <div className="row-between">
        <div><strong>{TYPE_LABEL[e.type]}</strong>{e.note && <> · {e.note}</>}<small>{name} · {dateTime(e.created_at)}</small></div>
        <span className={e.amount_cents > 0 ? 'amt pos' : 'amt neg'}>{money(e.amount_cents, { sign: true })}</span>
      </div>
      <input placeholder="Note (optional)" value={note} onChange={(ev) => setNote(ev.target.value)} />
      <div className="actions-row">
        <button className="btn primary" disabled={busy} onClick={() => decide(true)}>Approve</button>
        <button className="btn" disabled={busy} onClick={() => decide(false)}>Say no</button>
      </div>
      <ErrorText error={error} />
    </li>
  )
}

export function ParentEntryModal({ data, kind, onClose }) {
  const kids = children(data)
  const [child, setChild] = useState(kids[0]?.user_id)
  const [type, setType] = useState(kind === 'purchase' ? 'purchase' : 'gift')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState(kind === 'purchase' ? `Bought on ${data.me.display_name}'s card` : '')
  const [sign, setSign] = useState(1)
  const b = data.balances.find((x) => x.child_id === child)
  const { busy, error, run } = useAction()
  const cents = toCents(amount)
  const over = type === 'purchase' && b && cents > b.available_cents
  const submit = (e) => {
    e.preventDefault()
    if (!cents) return
    run(async () => {
      await rpc('parent_entry', { p_child: child, p_type: type, p_amount_cents: type === 'adjustment' ? sign * cents : cents, p_note: note || null })
      data.reload(); onClose()
    })
  }
  return (
    <Modal title={kind === 'purchase' ? 'Log purchase' : 'Add money'} onClose={onClose}>
      <form onSubmit={submit}>
        {kids.length > 1 && <Field label="For"><select value={child} onChange={(e) => setChild(e.target.value)}>{kids.map((k) => <option key={k.user_id} value={k.user_id}>{k.display_name}</option>)}</select></Field>}
        {kind === 'purchase'
          ? <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value)}><option value="purchase">Purchase on my card</option><option value="cash_out">Cash or Arvest card load</option></select></Field>
          : <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="gift">Gift</option><option value="business">Business income</option>
              <option value="chore">Chore</option><option value="schoolwork">Schoolwork</option><option value="activity">Activity</option>
              <option value="adjustment">Correction</option>
            </select></Field>}
        {type === 'adjustment' && <Field label="Direction"><select value={sign} onChange={(e) => setSign(Number(e.target.value))}><option value={1}>Add to her credit</option><option value={-1}>Take from her credit</option></select></Field>}
        <Field label="Amount" hint={b ? `Available now: ${money(b.available_cents)}` : null}>
          <input inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        {over && <p className="warn">This is more than her Available. It will eat into her loan money.</p>}
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorText error={error} />
        <button className="btn primary big" disabled={busy}>Save</button>
      </form>
    </Modal>
  )
}

function NewTaskModal({ data, onClose }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [hours, setHours] = useState('3')
  const { busy, error, run } = useAction()
  const submit = (e) => {
    e.preventDefault()
    const cents = toCents(amount)
    const h = Number(hours)
    if (!cents || !h) return
    run(async () => { await rpc('create_task', { p_name: name.trim(), p_amount_cents: cents, p_hours: h }); data.reload(); onClose() })
  }
  return (
    <Modal title="New task" onClose={onClose}>
      <p className="muted">Tap the mic on your keyboard to talk.</p>
      <form onSubmit={submit}>
        <Field label="Task"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Walk the dog" required autoFocus /></Field>
        <Field label="Pays"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$3" required /></Field>
        <Field label="Time limit">
          <select value={hours} onChange={(e) => setHours(e.target.value)}>
            {[['0.5', '30 minutes'], ['1', '1 hour'], ['2', '2 hours'], ['3', '3 hours'], ['4', '4 hours'], ['6', '6 hours'], ['12', '12 hours'], ['24', '1 day'], ['48', '2 days'], ['168', '1 week']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <ErrorText error={error} />
        <button className="btn primary big" disabled={busy}>Send to Amelia</button>
      </form>
    </Modal>
  )
}

export function ReverseModal({ data, e, onClose }) {
  const [note, setNote] = useState('')
  const { busy, error, run } = useAction()
  return (
    <Modal title="Reverse this?" onClose={onClose}>
      <p><strong>{e.note || TYPE_LABEL[e.type]}</strong> {money(e.amount_cents, { sign: true })} on {dateTime(e.created_at)}</p>
      <form onSubmit={(ev) => { ev.preventDefault(); run(async () => { await rpc('reverse_entry', { p_entry: e.id, p_note: note }); data.reload(); onClose() }) }}>
        <Field label="Why? She will see this."><input value={note} onChange={(ev) => setNote(ev.target.value)} required autoFocus placeholder="Room was not clean" /></Field>
        <ErrorText error={error} />
        <button className="btn danger big" disabled={busy}>Reverse {money(-e.amount_cents, { sign: true })}</button>
      </form>
    </Modal>
  )
}

export function EntryRow({ e, name, by, reversedBy, onReverse }) {
  const cls = e.status === 'rejected' || reversedBy ? 'amt struck' : e.amount_cents > 0 ? 'amt pos' : 'amt neg'
  return (
    <li className="entry">
      <div>
        <strong>{e.note || TYPE_LABEL[e.type]}</strong>
        <small>
          {TYPE_LABEL[e.type]}{name ? ` · ${name}` : ''} · {dateTime(e.created_at)}{by ? ` · ${by}` : ''}
          {e.status === 'pending' && ' · waiting'}
          {e.status === 'rejected' && ` · said no${e.decision_note ? ': ' + e.decision_note : ''}`}
          {reversedBy && ` · reversed: ${reversedBy.note}`}
        </small>
      </div>
      <div className="entry-right">
        <span className={cls}>{money(e.amount_cents, { sign: true })}</span>
        {onReverse && <button className="btn small" onClick={onReverse}>Reverse</button>}
      </div>
    </li>
  )
}
