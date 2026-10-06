export function PageLoading() {
  return (
    <div className="page" aria-busy="true">
      <div className="skeleton" style={{ height: 34, width: 260, marginBottom: 24 }} />
      <div className="grid grid-2">
        <div className="skeleton" style={{ height: 180 }} />
        <div className="skeleton" style={{ height: 180 }} />
      </div>
    </div>
  )
}

export function PageError({ error }: { error: unknown }) {
  return (
    <div className="page placeholder">
      <h2>Something went wrong</h2>
      <p className="muted">{error instanceof Error ? error.message : 'Please try again.'}</p>
    </div>
  )
}
