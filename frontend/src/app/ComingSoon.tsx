export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <div className="card placeholder" style={{ marginTop: 20 }}>
        <p>{text}</p>
        <p className="faint small">Not built yet.</p>
      </div>
    </div>
  )
}
