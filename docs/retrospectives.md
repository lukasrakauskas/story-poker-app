# Short-lived retrospectives

Visit `/retro` to create a retrospective, `/retro/<code>` to join, or `/retro/history` to read browser-local history. Poker remains a separate domain and protocol. Both domains reuse participant validation, room-access primitives and transport infrastructure.

## Participant flow

1. Room links are syntax-checked before opening a socket. Anonymous inspection returns only availability and whether a password is required—not protected titles, members, notes, actions or phase. Missing, expired, full and closed rooms do not ask for a participant name.
2. A saved identity is inspected without attaching/displacing a socket. Choose **Continue as [name]**, or confirm **Join as someone else / Forget this session**. Forget affects only that room; old content retains its original authorship. Names are normalized before the shared 3–30-character check. Entered names are never silently replaced by a resume command.
3. **Write:** participants see only their own notes, including moderators. Readiness is advisory and phase-specific. Unsent drafts are warned about before reveal.
4. **Group:** the moderator reveals notes and may group, move, ungroup or delete revealed notes. Grouping preserves text and attribution.
5. **Vote:** each participant has three selections across ungrouped notes and themes. Only their own selections are visible until discussion; voter identities remain server-only.
6. **Discuss:** anonymous totals and consistent tied rankings are revealed. The moderator records actions, assigns/reassigns participant or external owners, and marks completion. Removed owners retain their name snapshots. Mobile actions remain reachable.
7. **Closed:** a server `closedAt` timestamp freezes the participant record, notes, votes and actions. Late joins are rejected; retained identities can resume the frozen outcome until expiry. Final Markdown/text/JSON exports are available. Browser history is saved only under the participant's explicit policy.

## Identity and reconnect

The backend owns host-only, room-scoped `HttpOnly; Secure; SameSite=None; Path=/retro` cookies. No credential is readable by application JavaScript or sent in routine room events. Credentialed HTTP establishes, inspects, rotates and forgets identities; WebSocket attachment sends only the room code. See [the security threat model](retro-security.md) for origin configuration, replay, shared devices and separate-origin deployment.

Already-active sessions recover automatically after transient failures: jittered exponential delays start near one second and cap at 30 seconds, with at most six attempts before manual Retry is required. Thirty seconds of stable connectivity resets backoff. Offline and hidden tabs pause recovery; online/visibility signals resume it. Initial room-link visits still require explicit Continue. Replaced, rejected, removed and expired identities are terminal. Unacknowledged mutations are never replayed, and their uncertainty message survives authoritative recovery.

## Lifetime, storage and replicas

- Rooms expire two hours after creation, not after their last activity. Capacity is 100 rooms per repository namespace, 30 participants, 300 notes, 300 groups and 100 actions per room. Titles are bounded to 100 characters, note/action text to 1,000, external owners to 60.
- Disconnected identities have a persisted five-minute retention deadline. Resume before expiry restores ownership, readiness and role. Cleanup releases names/capacity and removes vote selections without erasing note/action attribution. A connected participant can claim a vacant moderator role; atomic updates select one winner. Closure is immutable under subsequent presence cleanup.
- `RetroRoomRepository` separates storage from domain logic. Default `RETRO_STORAGE=memory` is for local development/tests and loses rooms on restart. Configure `RETRO_STORAGE=redis` and `RETRO_REDIS_URL` for shared TTL state that survives application replacement. `RETRO_REDIS_PREFIX` can isolate deployments.
- Redis `WATCH`/`MULTI` transactions atomically commit domain updates, password authorization, credential rotation/revocation, connection ownership and expiry. Pub/sub coordinates recipient updates and replacement across replicas. Private storage contains token hashes and salted password verifiers, never public credentials. All replicas must share the same repository prefix and origin policy. Sticky routing is unnecessary for Redis-backed retrospectives; Poker is still process-local.
- Redis TTL removes room/tombstone keys; the heartbeat sweeps expiry indexes and membership deadlines every 30 seconds. Redis failure returns a storage error rather than silently falling back to divergent local state. Pub/sub is not a durable history queue: reconnect or a detected version gap requests authoritative state.
- Start optional Redis locally with `docker compose --profile shared-storage up --build` and configure `RETRO_STORAGE=redis`, `RETRO_REDIS_URL=redis://redis:6379`. Do not commit credentials or `.env` files. Monitor Redis availability and back up/configure Redis durability according to deployment needs; application restart survival is not a promise of surviving Redis data loss.

## Passwords, admission and operations

Optional passwords use the shared Poker/Retro room-access capability. The link alone reveals no protected content. Correct verification is required before creating membership. Passwords never enter cookies, snapshots, history, logs or exports; authorized resume does not resend them.

Production requires exact allowed browser origins via `RETRO_ALLOWED_ORIGINS` (or the shared `WS_ALLOWED_ORIGINS` policy). Use HTTPS/WSS and credentialed CORS; wildcard origins are rejected. Missing-Origin non-browser clients remain subject to admission and authentication.

Admission controls bound active/unauthenticated sockets, expensive operations per source, room creation and audience-weighted broadcast pressure. HTTP establishment/resume/forget/inspection uses the same operation admission boundary, so fresh sockets cannot bypass it. Configure `WS_MAX_ACTIVE_SOCKETS`, `WS_MAX_ACTIVE_SOCKETS_PER_SOURCE`, `WS_MAX_UNAUTHENTICATED_SOCKETS`, `WS_MAX_UNAUTHENTICATED_PER_SOURCE`, `WS_ADMISSION_WINDOW_MS`, `WS_CREATE_ATTEMPTS_PER_SOURCE`, `WS_JOIN_ATTEMPTS_PER_SOURCE`, `WS_RESUME_ATTEMPTS_PER_SOURCE`, `WS_PASSWORD_ATTEMPTS_PER_SOURCE`, `WS_GLOBAL_CREATE_LIMIT`, `WS_GLOBAL_CREATE_WINDOW_MS`, `WS_CREATE_CIRCUIT_COOLDOWN_MS`, `WS_BROADCAST_BUDGET`, `WS_BROADCAST_WINDOW_MS`, and `WS_BROADCAST_CIRCUIT_COOLDOWN_MS`. Defaults allow shared-team NATs while password attempts have a stricter budget. Commands also have a 30/second socket budget and 16 KiB inbound payload limit.

Forwarded IP headers are ignored by default. Enable `WS_TRUST_PROXY=true` only behind trusted proxies and set `WS_TRUSTED_PROXY_IPS`; proxies must overwrite rather than append untrusted client source headers. Source limits and pressure circuits are **per process**, not distributed Redis counters. Apply an edge/global admission policy across replicas if aggregate deployment limits are required. Metrics/logs report rejection, throttle, room/socket and capacity counts without room content or credentials.

## Browser history and privacy

No retrospective content is persisted before a history choice. The suggested choice is **final-only**, with **30-day retention**; optional recovery snapshots require explicit consent. Retention choices are 7, 30, 90 days or forever. Notes, names and action owners are accessible to anyone sharing the browser profile. Browser history is neither cross-device synchronization nor an exported backup.

Per-entry deletion also disables future saves for that room lifetime. **Delete all retrospective history** confirms accessibly and writes a suppression marker before removing data, including for rooms still open in other tabs. Explicitly reselecting a room is required to enable it again. Preference/storage failures do not interrupt collaboration; an unpersisted choice applies only to that tab. Resume credentials are separate and never enter localStorage.

Recovery writes coalesce for 250 ms and recheck consent/deletion markers at flush time. Final closed snapshots flush synchronously and remain immutable/idempotent. Navigation flushes pending consented work. Archives carry retention deadlines; reads and scheduled cleanup remove expired entries. Current shared archive schemas migrate older `retro-history-v1:` entries, strip legacy voter identities and protect private writing based on its recorded viewer. Corrupt entries are skipped with a warning.

`/retro/history` has no live socket and works without the room server, but the frontend must remain reachable; there is no service-worker/offline guarantee. Markdown, text and JSON exports allowlist public fields, retain owner attribution, escape user formatting and provide clipboard fallback. Exports from live rooms are restricted to the final outcome; saved incomplete recovery entries are labeled as last-seen snapshots.

## Broadcast performance and implementation

Each broadcast reads one committed repository room and reuses one validated public projection per version. A small recipient envelope contains private writing/own-vote selections; transport serializes the shared object once. Full public bytes are still sent per socket: typed deltas are deferred to keep recovery authoritative and simple. Clients validate the entire shared runtime event, reject stale versions, refresh gaps and honor request-specific acknowledgements even when updates interleave. Benchmarks are in [retro-benchmark.json](retro-benchmark.json); run `bun run --cwd apps/backend benchmark`. Measurements use in-memory storage and exclude Redis network latency.

- `packages/shared/retrospective.ts`: strict runtime contracts, inferred types, privacy projections, versions and archive migrations.
- `apps/backend/src/retro`: repository, domain service, async application use cases, HTTP sessions and thin WebSocket gateway.
- `apps/backend/src/transport`: serialization, admission, heartbeat, origin policy and sanitized metrics.
- `apps/frontend/lib/websocket-transport.ts`: shared Poker/Retro transport lifecycle; protocols remain separate.
- `apps/frontend/lib/retro-session-client.ts`: explicit session state, injected HTTP/history/clock/navigation adapters, acknowledgements, reconnect and gap recovery.
- `apps/frontend/lib/retro-history-session.ts`, `retro-history-writer.ts`, `retro-history.ts`: consent, coalescing, retention and storage adapters.
- `apps/frontend/tests/retro-fixtures.ts`: independent browser room/context/socket ownership. Focused scenarios cover collaboration, acknowledgements, privacy, ownership, responsive UI, identity/reconnect, actions, closure, history and exports.

## Verification

```sh
bun run --cwd apps/backend test
bun run --cwd apps/backend test:e2e
# Real Redis tests use isolated random key prefixes, never FLUSHDB:
RETRO_REDIS_URL=redis://localhost:6379 bun run --cwd apps/backend test
bun run --cwd apps/frontend test:unit
bunx turbo run build --force
bun run lint
CI=1 bun run --cwd apps/frontend test:e2e -- --workers=1
```

The browser suite uses separate mutable rooms and configurable test-only admission budgets for its single loopback source. Backend abuse tests exercise production policy defaults independently. See [stack verification](retro-stack-verification.md) for the completed PR order and executed checks.
