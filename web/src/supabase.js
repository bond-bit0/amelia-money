import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_KEY } from './config'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
})

// Calls an RPC and throws a readable error.
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}
