export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold tracking-tight">Rein</span>
          <span className="text-sm text-zinc-500">
            spending control for AI agents
          </span>
        </div>
        <p className="leading-7 text-zinc-600 dark:text-zinc-400">
          Every agent gets a corporate card with a real limit. Rein checks each
          purchase against the budget before money moves, signs a receipt, and
          records it in a ledger that holds under concurrent load.
        </p>
        <p className="text-sm text-zinc-500">
          Foundation in place. The dashboard arrives in a later phase.
        </p>
      </div>
    </main>
  );
}
