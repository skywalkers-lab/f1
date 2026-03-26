import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

declare global {
	interface Window {
		pitwallDesktop?: unknown
	}
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
