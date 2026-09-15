import type { ReactNode } from "react";

/** A theme is one voting target, with every original note kept in its stack. */
export function NoteStack({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <article
      aria-label={`Theme: ${title}`}
      className="relative mb-3 space-y-3 rounded-lg border bg-card p-4 text-card-foreground shadow-[3px_4px_0_0_var(--card),3px_4px_0_1px_var(--border),6px_8px_0_0_var(--card),6px_8px_0_1px_var(--border)]"
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-semibold">{title}</h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs">
          {count} notes
        </span>
      </header>
      {children}
    </article>
  );
}
