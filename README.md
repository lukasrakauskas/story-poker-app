# Turborepo starter

This is an official starter Turborepo.

## Getting started

Install [Bun](https://bun.sh) 1.4.2 and Node.js 22.12+ (or 24+) (used by the existing Next.js, Nest CLI, and Vitest tooling), then run from the repository root:

```sh
bun install
bun run dev
```

Commit `bun.lock` when dependencies change. CI and deployment should use `bun install --frozen-lockfile`.

### Vercel deployment

Set the Vercel project's **Root Directory** to `apps/frontend` and enable **Include source files outside of the Root Directory in the Build Step** so the shared workspaces are available. `apps/frontend/vercel.json` explicitly runs installation and builds with Bun 1.4.2 via `npx`, rather than Vercel's bundled Bun, which may not support the committed lockfile format. Installation runs from the repository root with `--frozen-lockfile`.

Keep the Bun versions in `package.json` and `apps/frontend/vercel.json` in sync when upgrading. Redeploy after applying these settings.

### Fly.io backend deployment

Keep `fly.toml` at the repository root: the backend Dockerfile needs the root `bun.lock`, `bunfig.toml`, and shared workspaces in its build context.

```sh
# From the repository root
bun run deploy:backend

# Or from apps/backend
bun run deploy
```

Both scripts run Fly from the repository root and forward additional CLI flags. For the build-only/push step, run this from the repository root:

```sh
bun run deploy:backend --build-only --push -a story-poker-backend --image-label <label>
```

If using Fly's Git deployment settings, set the working/build directory to the **repository root**, the config path to `fly.toml`, and the Dockerfile path to `apps/backend/Dockerfile`. `--config ../../fly.toml` alone does not change the build context. If invoking Fly directly from `apps/backend`, use `flyctl deploy ../.. --config fly.toml` (the config path is relative to the selected build context).

### Tests and tooling

Run backend tests with `bun run --cwd apps/backend test` (the project uses Vitest, not `bun test`).

The backend emits native ESM. TypeScript stays on 6.0.3 until Nest CLI supports TypeScript 7's compiler API; all other direct dependencies use the latest stable releases.

## What's inside?

This Turborepo includes the following packages/apps:

### Apps and Packages

- `docs`: a [Next.js](https://nextjs.org/) app
- `web`: another [Next.js](https://nextjs.org/) app
- `ui`: a stub React component library shared by both `web` and `docs` applications
- `tsconfig`: `tsconfig.json`s used throughout the monorepo

Each package/app is 100% [TypeScript](https://www.typescriptlang.org/).

### Utilities

This Turborepo has some additional tools already setup for you:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [Oxlint](https://oxc.rs/docs/guide/usage/linter) for code linting
- [Oxfmt](https://oxc.rs/docs/guide/usage/formatter) for code formatting

```sh
bun run lint          # Check code
bun run lint:fix      # Apply safe lint fixes
bun run format       # Format files
bun run format:check # Check formatting without writing
```

Configuration lives in `.oxlintrc.json` and `.oxfmtrc.json`. Generated output is excluded; backend files retain single quotes. Next.js no longer runs ESLint during builds, so run `bun run lint` separately in CI.

### Build

To build all apps and packages, run the following command:

```
bun run build
```

### Develop

To develop all apps and packages, run the following command:

```
bun run dev
```

### Remote Caching

Turborepo can use a technique known as [Remote Caching](https://turbo.build/repo/docs/core-concepts/remote-caching) to share cache artifacts across machines, enabling you to share build caches with your team and CI/CD pipelines.

By default, Turborepo will cache locally. To enable Remote Caching you will need an account with Vercel. If you don't have an account you can [create one](https://vercel.com/signup), then enter the following commands:

```
bunx turbo login
```

This will authenticate the Turborepo CLI with your [Vercel account](https://vercel.com/docs/concepts/personal-accounts/overview).

Next, you can link your Turborepo to your Remote Cache by running the following command from the root of your Turborepo:

```
bunx turbo link
```

## Useful Links

Learn more about the power of Turborepo:

- [Tasks](https://turbo.build/repo/docs/core-concepts/monorepos/running-tasks)
- [Caching](https://turbo.build/repo/docs/core-concepts/caching)
- [Remote Caching](https://turbo.build/repo/docs/core-concepts/remote-caching)
- [Filtering](https://turbo.build/repo/docs/core-concepts/monorepos/filtering)
- [Configuration Options](https://turbo.build/repo/docs/reference/configuration)
- [CLI Usage](https://turbo.build/repo/docs/reference/command-line-reference)
