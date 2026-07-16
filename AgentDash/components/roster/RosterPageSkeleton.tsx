export function RosterPageSkeleton() {
  return (
    <div>
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <div className="h-8 w-32 animate-pulse rounded bg-white/10" />
          <div className="mt-2 h-4 w-24 animate-pulse rounded bg-white/5" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <div className="h-10 w-64 animate-pulse rounded-md bg-white/10" />
        <div className="h-10 w-36 animate-pulse rounded-md bg-white/10" />
        <div className="h-10 w-36 animate-pulse rounded-md bg-white/10" />
        <div className="h-10 w-36 animate-pulse rounded-md bg-white/10" />
        <div className="h-10 w-24 animate-pulse rounded-md bg-[#2E7040]/40" />
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-white/10 bg-[#121614]">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="h-4 w-full max-w-3xl animate-pulse rounded bg-white/10" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-b border-white/5 px-4 py-4 last:border-b-0">
            <div className="h-4 w-full animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
