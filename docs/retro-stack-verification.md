# Retrospective PR stack verification

All 13 issue PRs are draft and unmerged. The parent coding assistant took over from the interrupted integration agent, resolved the remaining conflicts, reviewed the credential/session, persistence, broadcast and test integration paths, and ran the following checks against the complete stack.

## Merge/review order

| PR   | Issue                                              | Base   |
| ---- | -------------------------------------------------- | ------ |
| #117 | #86 shared runtime contracts                       | `main` |
| #116 | #92 normalized names                               | #117   |
| #118 | #84 protected rooms                                | #116   |
| #119 | #88 shared TTL storage                             | #118   |
| #120 | #90 admission controls                             | #119   |
| #122 | #87 transport/session separation                   | #120   |
| #121 | #96 credential hardening                           | #122   |
| #126 | #93 link validation                                | #121   |
| #127 | #95 explicit identity                              | #126   |
| #123 | #85 automatic recovery                             | #127   |
| #124 | #91 history consent/retention                      | #123   |
| #125 | #89 snapshot/persistence optimization              | #124   |
| #128 | #94 focused browser coverage and final integration | #125   |

Parents were merged into existing feature branches using normal fast-forward pushes, not force-pushed rebases. GitHub PR bases match the preceding branch. `main` remains at `a97d445`.

## Executed checks

- Backend unit/integration with a real local Redis instance: **135 passed**, none skipped. Includes multi-repository restart continuity, TTL, concurrent updates, pub/sub, cross-replica credential rotation/replay rejection and forget/revocation.
- Real HTTP/WebSocket integration: **6 passed**.
- Frontend unit/contract tests: **53 passed**. Includes strict HTTP/WS validation, matching acknowledgements, gap refresh, bounded recovery, no mutation replay, stale asynchronous response rejection, cookie-response ordering and history consent/deletion/retention.
- Complete Playwright suite: **45 passed**, one worker, approximately 2.5 minutes. Includes Poker and legal/social metadata coverage as well as retrospective scenarios. A transient ambiguous note/text-area selector was corrected to target the rendered article, then the entire suite was rerun successfully.
- Backend and frontend `tsc --noEmit`: passed.
- `bunx turbo run build --force`: both production builds passed, **zero cache hits**.
- Root lint: passed with warnings (including existing UI warnings).
- Changed-file formatting and `git diff --check`: passed. Repository-wide formatting was not used as a completion gate because unrelated baseline formatting drift was already present.
- `bun run --cwd apps/backend benchmark`: passed. Representative and near-limit measurements are recorded in `retro-benchmark.json`; Redis network latency is excluded from those microbenchmarks.

## Integration decisions and limits

- HTTP and WebSocket session paths share origin/admission policy; tokens stay in backend-owned HttpOnly cookies and hashed private storage. HTTP payloads use shared strict schemas and no-store responses. Routine broadcasts carry no bearer credential.
- Explicit remembered identity remains separate from automatic recovery of an already-active participant. Browser Web Locks serialize same-room cookie-changing requests across tabs; browsers without Web Locks have same-tab ordering only (see the security threat model).
- Broadcast versions come from atomic repository commits. Public projections/serialization are reused per version; private envelopes contain only recipient writing/own votes. Matching acknowledgements are not mistaken for peer broadcasts. Full snapshots remain on the wire; typed deltas are intentionally deferred.
- History requires consent, coalesces non-final writes, rechecks suppression on flush and immediately persists an opted-in final outcome. Deletion and immutable closure behavior were retained.
- Redis-backed Retro supports replicas; Poker remains process-local. Admission counters/circuits remain per process, so deployments needing aggregate multi-replica throttling must configure an edge-wide limiter. Third-party-cookie restrictions may require same-site backend proxying.
- No production deployment or real infrastructure restart was performed; restart continuity was verified using replacement repository/service instances against real Redis. No PR or issue was merged/closed automatically.
