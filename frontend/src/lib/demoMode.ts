function normalize(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

function fromUrl(): string {
  const params = new URLSearchParams(window.location.search)
  const direct = normalize(params.get('demo'))
  if (direct) return direct

  const alias = normalize(params.get('mode') ?? params.get('scenario'))
  if (alias) return alias

  // Support bare flag style like ?monaco
  if (window.location.search.toLowerCase().includes('monaco')) return 'monaco'

  return ''
}

function fromStorage(): string {
  try {
    return normalize(window.localStorage.getItem('pitwall_demo'))
  } catch {
    return ''
  }
}

function fromGlobal(): string {
  const w = window as Window & { __PITWALL_DEMO__?: string }
  return normalize(w.__PITWALL_DEMO__)
}

function fromEnv(): string {
  return normalize(import.meta.env.VITE_DEFAULT_DEMO_MODE as string | undefined)
}

export function resolveDemoMode(): string {
  return fromUrl() || fromStorage() || fromGlobal() || fromEnv() || ''
}

export function isMonacoDemoMode(): boolean {
  const mode = resolveDemoMode()
  return mode === 'monaco' || mode === 'mco'
}
