import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'

if ('serviceWorker' in navigator && !/^(www\.)?ameliabond\.online$/.test(location.hostname)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js', { type: import.meta.env.DEV ? 'module' : 'classic' }).catch(() => {})
  })
}

// Chrome on Android fires this when the app can be installed. Keep it so a button can trigger the install.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  window.__installPrompt = e
  window.dispatchEvent(new Event('installable'))
})
window.addEventListener('appinstalled', () => { window.__installPrompt = null; window.dispatchEvent(new Event('installable')) })

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
