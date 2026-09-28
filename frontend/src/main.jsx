import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
// Polish layer after App.css/feature styles so tokens win; motion last.
import './shared/components/ui-polish.css'
import './motion.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
