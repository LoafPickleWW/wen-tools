import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Browsers step a focused <input type="number"> on mouse wheel, so scrolling
// the page could silently change a supply or amount. Blur the field instead:
// the page scrolls and the value stays exactly as typed.
document.addEventListener(
  'wheel',
  (e) => {
    const el = document.activeElement
    if (el instanceof HTMLInputElement && el.type === 'number' && e.target === el) el.blur()
  },
  { passive: true },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
