import { rpc } from './supabase'
import { VAPID_PUBLIC_KEY } from './config'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function pushPermission() {
  return pushSupported() ? Notification.permission : 'unsupported'
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser cannot get notifications. Install the app from Chrome first.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications are blocked. Turn them on in Chrome site settings.')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })
  const j = sub.toJSON()
  await rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth })
}

// Re-save the subscription on start so a changed endpoint keeps working.
export async function refreshPush() {
  if (pushPermission() !== 'granted') return
  try { await enablePush() } catch { /* ignore */ }
}
