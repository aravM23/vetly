export default function App() {
  return (
    <main className="min-h-screen px-8 py-16">
      <div className="mx-auto max-w-3xl space-y-6">
        <p className="smallcaps text-paper-mute">Vetly</p>
        <h1 className="font-display text-5xl text-paper">
          AI Creator vetting, every morning.
        </h1>
        <p className="text-paper-mute">
          The repo skeleton is up. Next: Supabase, auth, ingest, scoring, digest.
        </p>
        <div className="flex items-center gap-3 pt-4">
          <span className="score-badge">92</span>
          <span className="font-mono text-sm text-paper-mute">@example.creator</span>
        </div>
      </div>
    </main>
  )
}
