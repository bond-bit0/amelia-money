import { useState } from 'react'
import { TYPE_LABEL } from './format'
import { EntryRow, ReverseModal } from './Home'
import { Empty } from './ui'
import { supabase } from './supabase'

const FILTERS = {
  all: () => true,
  earned: (e) => ['chore', 'schoolwork', 'activity', 'task'].includes(e.type),
  received: (e) => ['gift', 'business', 'loan_disbursement'].includes(e.type),
  spent: (e) => ['purchase', 'cash_out'].includes(e.type),
  loan: (e) => ['loan_payment', 'repo_sale', 'loan_disbursement'].includes(e.type),
  fixes: (e) => ['reversal', 'adjustment'].includes(e.type) || e.status === 'rejected',
}

export function Activity({ data }) {
  const [filter, setFilter] = useState('all')
  const [reverse, setReverse] = useState(null)
  const isParent = data.me.role === 'parent'
  const byReversed = Object.fromEntries(data.entries.filter((e) => e.reverses_entry_id).map((e) => [e.reverses_entry_id, e]))
  const name = (id) => data.members.find((m) => m.user_id === id)?.display_name
  const many = data.members.filter((m) => m.role === 'child').length > 1
  const list = data.entries.filter(FILTERS[filter])
  const whoDid = (e) => {
    const parts = []
    if (e.created_by !== e.child_id) parts.push(`by ${name(e.created_by)}`)
    if (e.decided_by && e.decided_by !== e.created_by) parts.push(`${e.status === 'rejected' ? 'turned down' : 'approved'} by ${name(e.decided_by)}`)
    return parts.join(', ') || null
  }

  return (
    <>
      <section className="card">
        <div className="row-between"><h2>Activity</h2>{isParent && <button className="btn small" onClick={() => exportCsv(data)}>Export CSV</button>}</div>
        <div className="chips">
          {Object.keys(FILTERS).map((f) => <button key={f} className={'chip' + (f === filter ? ' on' : '')} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
        </div>
        {list.length === 0 && <Empty>Nothing here yet.</Empty>}
        <ul className="list">
          {list.map((e) => (
            <EntryRow key={e.id} e={e} name={many ? name(e.child_id) : null} by={isParent ? whoDid(e) : null} reversedBy={byReversed[e.id]}
              onReverse={isParent && e.status === 'approved' && e.type !== 'reversal' && !byReversed[e.id] ? () => setReverse(e) : null} />
          ))}
        </ul>
        {isParent && <p className="muted small">Entries are never deleted. A mistake gets a reversal, so the history stays honest.</p>}
      </section>
      {reverse && <ReverseModal data={data} e={reverse} onClose={() => setReverse(null)} />}
    </>
  )
}

async function exportCsv(data) {
  const { data: all } = await supabase.from('entry').select('*').order('created_at')
  const entries = all || [...data.entries].reverse()
  const name = (id) => data.members.find((m) => m.user_id === id)?.display_name || ''
  const loan = (id) => data.loans.find((l) => l.id === id)?.name || ''
  const rows = [['date', 'time', 'child', 'type', 'amount', 'status', 'note', 'loan', 'logged_by', 'decided_by', 'decision_note', 'reverses_entry', 'id']]
  for (const e of entries) {
    const d = new Date(e.created_at)
    rows.push([e.occurred_on, d.toLocaleTimeString('en-US'), name(e.child_id), TYPE_LABEL[e.type], (e.amount_cents / 100).toFixed(2), e.status,
      e.note || '', loan(e.loan_id), name(e.created_by), name(e.decided_by), e.decision_note || '', e.reverses_entry_id || '', e.id])
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `amelia-money-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

