import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme.css'

try { document.documentElement.dataset.theme = localStorage.getItem('flowweb-theme') === 'light' ? 'light' : 'dark' } catch { document.documentElement.dataset.theme = 'dark' }

// A render error must never leave a blank window.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return <div style={{ padding: 32, font: '14px Tahoma, sans-serif', direction: 'rtl', color: '#d9e2f1', background: '#0b111c', minHeight: '100vh' }}>
      <h2>خطا در نمایش برنامه</h2>
      <p>اگر تازه به‌روزرسانی کرده‌اید، یک بار <code>npm run build</code> را اجرا کنید تا بخش اصلی و رابط هم‌نسخه شوند.</p>
      <pre style={{ whiteSpace: 'pre-wrap', direction: 'ltr' }}>{String(this.state.error.stack ?? this.state.error)}</pre>
      <button onClick={() => location.reload()}>بارگذاری دوباره</button>
    </div>
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>
)
