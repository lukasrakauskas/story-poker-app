# Story Poker

**Less setup. More discussion. Better estimates.**

Story Poker is a real-time planning poker app for teams that want to estimate work together. Create a room, share a link, and pick your cards. Estimates stay hidden until the moderator reveals them, so everyone can think for themselves before the discussion starts.

Our team has happily used Story Poker since 2023 without any hiccups. It is a small part of our planning sessions, and we like keeping it simple.

**[Try Story Poker →](https://story-poker.rake.lt)**

## A planning session in a few clicks

1. **Create a room.** Enter your name and add a room password if you need one. No account required.
2. **Invite the team.** Share the room link or let teammates scan the QR code.
3. **Estimate independently.** Discuss the story, then choose a card. You can change or remove your vote before the reveal.
4. **Reveal together.** The moderator reveals the estimates. Compare the vote distribution and talk through the differences.
5. **Start the next round.** Reset the votes when the team is ready for another story.

## What makes it useful

- **Private voting, shared results.** See who has voted without seeing their estimate too early.
- **Cards that fit your team.** Use the default deck or supply a custom set of values.
- **Clear results.** A chart, vote counts, and result highlights help the team spot agreement and split votes.
- **Simple room controls.** Moderators reveal results, start new rounds, promote teammates, and remove participants when needed.
- **Easy invitations.** Room links and QR codes work for remote and in-person sessions.
- **Optional room passwords.** Add a password when a shared link alone is not enough.
- **Reconnect support.** Recover your place after a brief connection loss.
- **A little personality.** Pick an avatar and use the light or dark theme.

The default deck is:

```text
0 · 1/2 · 1 · 2 · 3 · 5 · 8 · 13 · 20 · 40 · 100 · ?
```

For a custom deck, open the home page with a comma-separated `cardSet` query parameter before you create a room. For example, [use T-shirt sizes](https://story-poker.rake.lt/?cardSet=XS,S,M,L,XL).

## Run it locally

### Requirements

- [Bun](https://bun.sh/) **1.4.2**, the version pinned in `package.json`.
- **Node.js 22.12+ within the 22.x release line, 24.x, or 26+**, as specified in `package.json`. Existing Next.js, Nest CLI, and Vitest tooling uses Node.js.

From the repository root:

```sh
git clone https://github.com/lukasrakauskas/story-poker-app.git
cd story-poker-app
bun install
bun run dev
```

Open **[http://localhost:3000](http://localhost:3000)**. The backend listens on port **4000** by default.

The checked-in development configuration connects the frontend to `ws://localhost:4000`. To use another backend, create `apps/frontend/.env.development.local`:

```dotenv
NEXT_PUBLIC_WS_URL=ws://localhost:4000
```

Restart the frontend after you change this value. Set `PORT` for the backend if you need a different listening port, and update the WebSocket URL to match.

### Useful commands

Run these commands from the repository root:

| Command                                 | Purpose                                             |
| --------------------------------------- | --------------------------------------------------- |
| `bun run dev`                           | Start the frontend and backend in development mode. |
| `bun run build`                         | Build all workspaces with Turborepo.                |
| `bun run lint`                          | Check code with Oxlint.                             |
| `bun run lint:fix`                      | Apply safe lint fixes.                              |
| `bun run format`                        | Format files with Oxfmt.                            |
| `bun run format:check`                  | Check formatting without changing files.            |
| `bun run --cwd apps/backend test`       | Run backend unit tests with Vitest.                 |
| `bun run --cwd apps/frontend test:unit` | Run frontend unit tests.                            |
| `bun run --cwd apps/frontend test:e2e`  | Run frontend browser tests with Playwright.         |

Use the backend test script, not `bun test`: the backend test suite uses Vitest.

Commit `bun.lock` when dependencies change. CI and deployment builds should install dependencies with `bun install --frozen-lockfile`.

## Project structure

This TypeScript monorepo uses Bun workspaces and Turborepo.

```text
apps/
  frontend/          Next.js and React app
  backend/           NestJS API and WebSocket server
packages/
  ui/                Shared UI components
  shared/            Shared types and contracts
  tailwind-config/   Shared Tailwind configuration
  tsconfig/          Shared TypeScript configuration
```

The frontend uses Tailwind CSS for styling and Recharts for vote results. The backend keeps participants and voting rounds in sync over native WebSockets.

For command payloads and backend boundaries, see the [Planning Poker WebSocket reference](docs/planning-websocket.md).

## Deployment

### Frontend: Vercel

1. Set the project's **Root Directory** to `apps/frontend`.
2. Enable **Include source files outside of the Root Directory in the Build Step** so shared workspaces are available.
3. Set `NEXT_PUBLIC_WS_URL` to your backend's public WebSocket URL, such as `wss://your-backend.example.com`, before building. Use `wss://` when the frontend is served over HTTPS.

The configuration in `apps/frontend/vercel.json` installs dependencies from the repository root with `--frozen-lockfile` and explicitly uses Bun 1.4.2 for installation and builds. This avoids lockfile compatibility issues with Vercel's bundled Bun. Keep that version in sync with `package.json` when upgrading.

The checked-in production environment file contains a Railway URL template. Override it with the actual backend URL for your deployment, then redeploy.

### Backend: Fly.io

Keep `fly.toml` at the repository root. The backend Dockerfile needs the root `package.json`, `bun.lock`, and shared workspaces in its build context.

```sh
# From the repository root
bun run deploy:backend

# Or from apps/backend
bun run deploy
```

Both scripts deploy from the repository root and forward additional CLI flags. For a build-only push:

```sh
bun run deploy:backend --build-only --push -a story-poker-backend --image-label <label>
```

For Fly's Git deployment settings, use:

| Setting                 | Value                     |
| ----------------------- | ------------------------- |
| Working/build directory | Repository root           |
| Config path             | `fly.toml`                |
| Dockerfile path         | `apps/backend/Dockerfile` |

If you invoke Fly directly from `apps/backend`, include the repository-root build context:

```sh
flyctl deploy ../.. --config fly.toml
```

The config path is relative to that build context. Passing `--config ../../fly.toml` alone does not change the context and is not sufficient. The Dockerfile explicitly selects Bun's hoisted linker in both install stages.

### Hosting notes

- Set `WS_ALLOWED_ORIGINS` on the backend to a comma-separated list of allowed frontend origins, such as `https://your-frontend.example.com`. Production WebSocket connections require an explicit allowed origin.
- Make sure your hosting proxy supports WebSocket upgrades.
- Story Poker rooms live in backend memory. A backend restart clears them; use a single backend instance unless you add shared room storage and routing support.
- Disconnected participants can reconnect for five minutes. Empty rooms remain available for 15 minutes before cleanup.
