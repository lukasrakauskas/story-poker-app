import { ModeToggle } from "../components/mode-toggle";

export function SiteHeader() {
  return (
    <header className="supports-backdrop-blur:bg-background/60 sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <h2 className="text-lg font-semibold">Story Poker</h2>
        <div className="flex flex-1 items-center justify-between space-x-2 pl-4 md:pl-8 sm:space-x-4">
          <nav className="flex flex-1 items-center justify-between space-x-1">
            <a href="https://buymeacoffee.com/rakauskas" target="_blank">
              Support
            </a>
            <ModeToggle />
          </nav>
        </div>
      </div>
    </header>
  );
}
