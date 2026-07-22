import { useEffect, useState } from 'react'

type HealthState = 'checking' | 'ok' | 'unreachable'

export default function App() {
  const [health, setHealth] = useState<HealthState>('checking')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('bad status'))))
      .then(() => setHealth('ok'))
      .catch(() => setHealth('unreachable'))
  }, [])

  return (
    <main className="scaffold">
      <h1>weather-commit-graph</h1>
      <p>Renders your git history as a weather forecast.</p>
      <p className="status" data-state={health}>
        api: {health}
      </p>
    </main>
  )
}
