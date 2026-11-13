import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js', { type: import.meta.env.DEV ? 'module' : 'classic' }).catch(() => {})
  })
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
