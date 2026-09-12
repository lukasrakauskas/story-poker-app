# Shared UI

The full published `registry:ui` component set from shadcn's `new-york-v4`
registry is installed here (using shadcn CLI 4.21.0). Components use the current
React 19 / Tailwind 4 APIs and are imported individually:

```tsx
import { Button } from "ui/components/button";
import { DropdownMenu } from "ui/components/dropdown-menu";
import { Textarea } from "ui/components/textarea";
```

Import `ui/styles.css` once in the application's global stylesheet and include
`@source "../../../packages/ui"` (adjust relative to that stylesheet). It supplies
the shared light/dark palette, chart/sidebar tokens, and Tailwind configuration.
Keep product-specific overrides in the application stylesheet.

## Updating

From the repository root:

```sh
bunx shadcn@latest add button --cwd packages/ui --overwrite
bunx shadcn@latest add --all --cwd packages/ui --overwrite
bunx tsc --noEmit -p packages/ui
bun run --cwd apps/frontend build
bun run --cwd apps/frontend test:e2e
```

`components.json` and the `ui/*` TypeScript path mapping keep generated files in
this package. If `--all` fails on a missing registry entry (currently
`questionnaire`), pass the published `registry:ui` names explicitly instead.
Application blocks and example pages are not part of this library.

The legacy `toast`, `toaster`, and `use-toast` files remain for existing consumers;
use `sonner` for new toast integrations. Wrap tooltip consumers in
`TooltipProvider`, and mount a `Toaster` when using notifications.

Retro reuses dropdown menus and alert dialogs for item actions, textareas for
note/action forms, checkboxes for action completion, and badges for counts and
status. Room authorization and phase rules remain in the application.
