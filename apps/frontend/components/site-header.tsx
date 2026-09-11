import Link from "next/link";
import { ModeToggle } from "../components/mode-toggle";

export function SiteHeader() {
  return (
    <header className="supports-backdrop-blur:bg-background/60 sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-8">
        <Link
          href="/"
          className="text-lg font-semibold rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Story Poker
        </Link>
        <nav
          aria-label="Main navigation"
          className="flex items-center gap-4 text-sm"
        >
          <Link
            href="/"
            className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Poker
          </Link>
          <Link
            href="/retro"
            className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retrospective
          </Link>
          <a
            href="https://buymeacoffee.com/rakauskas"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden underline-offset-4 hover:underline sm:inline"
          >
            Support
          </a>
          <ModeToggle />
        </nav>
      </div>
    </header>
  );
}
