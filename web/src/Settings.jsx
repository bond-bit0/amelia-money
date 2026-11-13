import { useState } from 'react'
import { supabase, rpc } from './supabase'
import { money, toCents, TYPE_LABEL } from './format'
import { Modal, Field, ErrorText, useAction, Empty } from './ui'
import { limitText } from './Home'
import { enablePush, pushPermission, pushSupported } from './push'

export function Settings({ data, email }) {
  const isParent = data.me.role === 'parent'
  return (
    <>
      <Notifications />
      <InstallHint />
      {isParent && <Chores data={data} />}
      <Members data={data} />
      <section className="card">
        <h2>Account</h2>
        <p className="muted">Signed in as {email}</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </section>
    </>
  )
}

function Notifications() {
  const [perm, setPerm] = useState(pushPermission())
  const { busy, error, run } = useAction()
  return (
    <section className="card">
      <h2>Notifications</h2>
      {perm === 'granted' && <p>On for this device.</p>}
      {perm === 'unsupported' && <p className="muted">This browser can't get notifications. On Android, open the app in Chrome and add it to the Home screen.</p>}
      {perm !== 'granted' && pushSupported() && (
        <button className="btn primary big" disabled={busy} onClick={() => run(async () => { await enablePush(); setPerm(pushPermission()) })}>Turn on notifications</button>
      )}
      {perm === 'granted' && <button className="btn small" disabled={busy} onClick={() => run(enablePush)}>Re-register this device</button>}
      <ErrorText error={error} />
    </section>
  )
}

function InstallHint() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
  if (standalone) return null
  return (
    <section className="card">
      <h2>Install the app</h2>
      <p>In Chrome, tap the ⋮ menu, then <strong>Add to Home screen</strong> (or <strong>Install app</strong>). It gets its own icon and can send notifications.</p>
    </section>
  )
}

function Chores({ data }) {
  const [edit, setEdit] = useState(null)
  const standing = data.chores.filter((c) => c.type !== 'task')
  return (
    <section className="card">
      <div className="row-between"><h2>Jobs and pay</h2><button className="btn small" onClick={() => setEdit({})}>+ Add</button></div>
      {standing.length === 0 && <Empty>Add the jobs Amelia can claim. Let her help set the prices.</Empty>}
      <ul className="list">{standing.map((c) => (
        <li key={c.id} className={'row-between' + (c.active ? '' : ' inactive')}>
          <div><strong>{c.name}</strong> · {money(c.amount_cents)}<small>{limitText(c)}{c.active ? '' : ' · off'}</small></div>
          <button className="btn small" onClick={() => setEdit(c)}>Edit</button>
        </li>
      ))}</ul>
      {edit && <ChoreModal data={data} chore={edit} onClose={() => setEdit(null)} />}
    </section>
  )
}

function ChoreModal({ data, chore, onClose }) {
  const isNew = !chore.id
  const hrs = chore.min_hours_between
  const [f, setF] = useState({
    name: chore.name || '', type: chore.type || 'chore', amount: chore.amount_cents ? (chore.amount_cents / 100).toFixed(2) : '',
    every: hrs ? (hrs % 24 === 0 ? String(hrs / 24) : String(hrs)) : '', unit: hrs && hrs % 24 !== 0 ? 'hours' : 'days',
    perDay: chore.max_per_day ? String(chore.max_per_day) : '', active: chore.active ?? true,
  })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const { busy, error, run } = useAction()
  const submit = (e) => {
    e.preventDefault()
    const cents = toCents(f.amount)
    if (!cents) return
    const every = Number(f.every)
    const row = {
      name: f.name.trim(), type: f.type, amount_cents: cents,
      min_hours_between: every > 0 ? (f.unit === 'days' ? every * 24 : every) : null,
      max_per_day: parseInt(f.perDay, 10) > 0 ? parseInt(f.perDay, 10) : null, active: f.active,
    }
    run(async () => {
      const q = isNew
        ? supabase.from('chore').insert({ ...row, family_id: data.me.family_id, created_by: data.me.user_id })
        : supabase.from('chore').update(row).eq('id', chore.id)
      const { error } = await q
      if (error) throw error
      data.reload(); onClose()
    })
  }
  return (
    <Modal title={isNew ? 'Add a job' : 'Edit job'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Name"><input value={f.name} onChange={set('name')} placeholder="Clean room" required autoFocus /></Field>
        <Field label="Kind"><select value={f.type} onChange={set('type')}>{['chore', 'schoolwork', 'activity'].map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></Field>
        <Field label="Pays"><input inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="$5" required /></Field>
        <Field label="Once every" hint="Leave blank for no wait between claims">
          <div className="inline"><input inputMode="decimal" value={f.every} onChange={set('every')} placeholder="2" /><select value={f.unit} onChange={set('unit')}><option value="days">days</option><option value="hours">hours</option></select></div>
        </Field>
        <Field label="Most times a day" hint="Leave blank for no daily cap"><input inputMode="numeric" value={f.perDay} onChange={set('perDay')} placeholder="2" /></Field>
        {!isNew && <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Amelia can claim this</label>}
        <ErrorText error={error} />
        <button className="btn primary big" disabled={busy}>Save</button>
      </form>
    </Modal>
  )
}

function Members({ data }) {
  const isParent = data.me.role === 'parent'
  const [role, setRole] = useState('child')
  const [name, setName] = useState('')
  const [code, setCode] = useState(null)
  const { busy, error, run } = useAction()
  return (
    <section className="card">
      <h2>Family: {data.family?.name}</h2>
      <ul className="list">{data.members.map((m) => (
        <li key={m.user_id} className="row-between"><span>{m.display_name}{m.user_id === data.me.user_id ? ' (you)' : ''}</span><small>{m.role === 'parent' ? 'Parent' : 'Child'}</small></li>
      ))}</ul>
      {isParent && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => setCode(await rpc('create_invite', { p_role: role, p_display_name: name.trim() }))) }}>
          <h3>Invite someone</h3>
          <div className="inline">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Amelia" required />
            <select value={role} onChange={(e) => setRole(e.target.value)}><option value="child">Child</option><option value="parent">Parent</option></select>
          </div>
          <button className="btn big" disabled={busy}>Make invite code</button>
          {code && <div className="invite-code"><span>Code for {name}</span><strong>{code}</strong><small>They create an account, then enter this code. Works once, for 7 days.</small></div>}
          <ErrorText error={error} />
        </form>
      )}
    </section>
  )
}
