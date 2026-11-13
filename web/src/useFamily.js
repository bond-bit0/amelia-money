import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// Loads everything the app shows for the signed-in member's family, and keeps it fresh.
export function useFamily(userId) {
  const [state, setState] = useState({ loading: true })
  const timer = useRef(null)

  const load = useCallback(async () => {
    const { data: me, error: meErr } = await supabase.from('member').select('*').eq('user_id', userId).maybeSingle()
    if (meErr) { setState({ loading: false, error: meErr.message }); return }
    if (!me) { setState({ loading: false, me: null }); return }
    const [family, members, chores, entries, loans, schedule, balances, notes] = await Promise.all([
      supabase.from('family').select('*').eq('id', me.family_id).single(),
      supabase.from('member').select('*').order('created_at'),
      supabase.rpc('chore_status'),
      supabase.from('entry').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('loan').select('*').order('created_at', { ascending: false }),
      supabase.from('loan_schedule').select('*').order('payment_no'),
      supabase.rpc('balances'),
      supabase.from('notification').select('*').order('created_at', { ascending: false }).limit(30),
    ])
    const err = [family, members, chores, entries, loans, schedule, balances, notes].find((r) => r.error)
    setState({
      loading: false,
      error: err?.error?.message,
      me,
      family: family.data,
      members: members.data || [],
      chores: chores.data || [],
      entries: entries.data || [],
      loans: loans.data || [],
      schedule: schedule.data || [],
      balances: balances.data || [],
      notifications: notes.data || [],
    })
  }, [userId])

  const reload = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(load, 250)
  }, [load])

  useEffect(() => {
    load()
    const ch = supabase.channel('family-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entry' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chore' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_schedule' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification' }, reload)
      .subscribe()
    const iv = setInterval(load, 60000)
    const onFocus = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onFocus)
    return () => { supabase.removeChannel(ch); clearInterval(iv); document.removeEventListener('visibilitychange', onFocus) }
  }, [load, reload])

  return { ...state, reload: load }
}
