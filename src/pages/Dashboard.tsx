export default function DashboardPage() {
  return (
    <main className="px-8 py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="space-y-2">
          <p className="smallcaps text-paper-mute">Today</p>
          <h1 className="font-display text-4xl text-paper">Top picks.</h1>
          <p className="text-sm text-paper-mute">
            Dashboard placeholder. Step 6 fills in the Creator table, filters, and drawer.
          </p>
        </div>

        <section className="flex items-center gap-3 rounded-sm border border-ink-3 bg-ink-2 p-4">
          <span className="score-badge">92</span>
          <span className="font-mono text-sm text-paper">@example.creator</span>
          <span className="text-xs text-paper-mute">instagram, 248k followers</span>
        </section>
      </div>
    </main>
  )
}
