import { useEffect, useState } from 'react'
import { supabase, rpc } from './supabase'
import { useFamily } from './useFamily'
import { Field, ErrorText, useAction } from './ui'
import { ChildHome, ParentHome } from './Home'
import { Activity } from './Activity'
import { Loans } from './Loans'
import { Settings, InstallHint } from './Settings'
import { refreshPush } from './push'

export default function App() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <Splash />
  if (!session) return <SignIn />
  return <Signed userId={session.user.id} email={session.user.email} />
}

function Splash() {
  return <div className="center"><div className="logo">$</div></div>
}

function SignIn() {
  const [mode, setMode] = useState('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()
  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      const fn = mode === 'in' ? supabase.auth.signInWithPassword : supabase.auth.signUp
      const { error } = await fn.call(supabase.auth, { email: email.trim(), password })
      if (error) throw error
    })
  }
  return (
    <div className="auth">
      <div className="logo">$</div>
      <h1>Amelia Money</h1>
      <form onSubmit={submit} className="card">
        <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password" hint={mode === 'up' ? 'At least 8 characters' : null}>
          <input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <ErrorText error={error} />
        <button className="btn primary big" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="btn link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}

function Onboard({ onDone }) {
  const [code, setCode] = useState('')
  const [fam, setFam] = useState('')
  const [name, setName] = useState('')
  const { busy, error, run } = useAction()
  return (
    <div className="auth">
      <h1>Welcome</h1>
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc('join_family', { p_code: code }); onDone() }) }}>
        <h2>Join your family</h2>
        <p className="muted">A parent gives you a 6-letter code from Settings.</p>
        <Field label="Invite code"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} required className="code-input" /></Field>
        <button className="btn primary big" disabled={busy}>Join</button>
      </form>
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc('create_family', { p_family_name: fam, p_display_name: name }); onDone() }) }}>
        <h2>Or start a new family</h2>
        <p className="muted">Only the first parent does this.</p>
        <Field label="Family name"><input value={fam} onChange={(e) => setFam(e.target.value)} placeholder="Bond" required /></Field>
        <Field label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dad" required /></Field>
        <button className="btn big" disabled={busy}>Start family</button>
      </form>
      <ErrorText error={error} />
      <button className="btn link" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  )
}

const ICON = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  activity: <path d="M4 6h16M4 12h16M4 18h10" />,
  loan: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
}
const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'activity', label: 'Activity' },
  { id: 'loan', label: 'Loan' },
  { id: 'settings', label: 'Settings' },
]

function Signed({ userId, email }) {
  const data = useFamily(userId)
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') || 'home')
  useEffect(() => { refreshPush() }, [])
  useEffect(() => {
    const url = new URL(location.href); url.searchParams.set('tab', tab); history.replaceState(null, '', url)
  }, [tab])

  if (data.loading) return <Splash />
  if (!data.me) return <Onboard onDone={data.reload} />
  const isParent = data.me.role === 'parent'

  return (
    <div className="app">
      <header className="top">
        <span className="brand">Amelia Money</span>
        <span className="who">{data.me.display_name}</span>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">{ICON[t.id]}</svg>{t.label}
          </button>
        ))}
      </nav>
      {data.error && <p className="error banner">{data.error}</p>}
      <main>
        {tab === 'home' && <InstallHint compact />}
        {tab === 'home' && (isParent ? <ParentHome data={data} go={setTab} /> : <ChildHome data={data} go={setTab} />)}
        {tab === 'activity' && <Activity data={data} />}
        {tab === 'loan' && <Loans data={data} />}
        {tab === 'settings' && <Settings data={data} email={email} />}
      </main>
    </div>
  )
}
