export function PlaceholderPage({
  title,
  phase,
}: {
  title: string;
  phase: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-neutral-100">{title}</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Not yet implemented — {phase}. This route renders as a placeholder
        per the Phase 0 scope (structure only, no data fetching).
      </p>
    </div>
  );
}
