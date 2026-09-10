# Turborepo starter

This is an official starter Turborepo.

## Getting started

Install [Bun](https://bun.sh) 1.4.2 and Node.js 22+ (used by the existing Next.js, Nest CLI, and Jest tooling), then run from the repository root:

```sh
bun install
bun run dev
```

Commit `bun.lock` when dependencies change. CI and deployment should use `bun install --frozen-lockfile`.

Run backend tests with `bun run --cwd apps/backend test` (the project uses Jest, not `bun test`).

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
