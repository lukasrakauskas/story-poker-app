# Short-lived retrospectives

Visit `/retro` to create a room, or share `/retro/<code>` to invite participants. This is independent of the planning-poker routes and uses a separate WebSocket endpoint at `/retro` on the backend origin configured by `NEXT_PUBLIC_WS_URL`.

## Flow

1. **Write:** everyone adds notes under Went well, To improve, or Ideas. Each participant receives only their own notes during this phase, including after reconnecting; moderators do not see anyone else's writing. Only the author can edit/delete a note. Participants explicitly mark writing done when ready.
2. **Group:** the moderator reveals the complete attributed board to everyone in one phase transition. The team reviews it while the moderator creates named themes from two or more related notes, moves notes between themes, or ungroups them. Grouping never changes note text or author attribution.
3. **Vote:** themes are one voting target each, while ungrouped notes remain individual targets. Each person has three votes, at most one per target; clicking again removes a vote so it can be moved. Voting totals stay hidden and voter identities stay server-only until the moderator starts discussion. Participants explicitly mark voting done even when they intentionally use fewer than three votes.
4. **Discuss:** the moderator advances again, revealing anonymous aggregate totals, reviews the ranked themes and notes, and creates action items with an owner. The moderator can mark actions done or delete them.
5. **Closed:** the moderator closes the retrospective, recording a server `closedAt` timestamp and freezing the participant/presence record, notes, votes, and actions. New joins are rejected with a clear message; retained participants can resume read-only until room expiry without changing the final record. The invitation UI is replaced by the participant record at closure. Share Copy Markdown or Markdown, text, and JSON downloads with anyone else. Connected browsers save the completed snapshot, including final action owners and completion status.
6. **Previous retrospectives:** open `/retro/history` to read saved notes, themes, participants, and action items without an account or a live room. Every saved entry keeps its export controls, including incomplete snapshots. Live-room export controls are deliberately hidden during writing, grouping, voting, and discussion so partial work is not presented as the outcome.

## Room status and supporting information

- Readiness is scoped to the active write or vote phase and resets for everyone on every phase change. New participants start not ready. A disconnected participant is excluded from the moderator's `ready / active participants` count; reconnecting during the same phase restores their prior ready/not-ready choice and returns them to the active count.
- The moderator's advance confirmation names every connected participant who is not ready, but readiness is advisory so offline participants cannot block progress. A moderator with an unsent local note draft also receives a destructive-impact warning, and participants cannot mark writing done until their local drafts are submitted or cleared.
- In a live room, connection/retry, expiry, rejoin-cookie, and browser-history state share one compact status card. It sits in the right sidebar on desktop and immediately before the board on mobile, rather than stacking banners above the workflow.
- The status card includes a concise privacy/browser-storage disclosure. Terminal expiry and invalid-session errors remain prominent above the room, while command errors stay next to the active workflow.
- Before a room is entered, connection failures and Retry remain inside the lobby card next to the create/join form; room-only expiry and storage notices are not rendered above the lobby.

## Lifetime and limitations

- Live collaboration still exists **only in backend process memory**. The domain-neutral collaboration registry is shared in code by Poker and Retro, but there is no server database or disk persistence. Each participating browser separately saves token-free snapshots in localStorage.
- Rooms expire **two hours after creation**, even if active. Expired rooms reject commands immediately and are swept every 30 seconds. A server restart loses all rooms.
- Reconnection credentials are stored in one host-only cookie per room (`retro-session-<code>`, `Path=/retro`, `SameSite=Lax`, `Secure` on HTTPS). Cookies expire with the room, not with the tab, and are never stored in localStorage. Reopening the room link restores the same identity, note ownership, votes, and moderator access while the live room exists and the identity remains within its offline retention window. Joining a remembered room by code also resumes that identity.
- Cookies are JavaScript-readable, **not HttpOnly**: the existing WebSocket protocol explicitly sends the credential in a resume command rather than authenticating through HTTP cookies. This is not an XSS-hardening change. Invalid/expired credentials are cleared; rejected resumes do not silently create a new identity. Opening the same room in another tab moves the live connection to that tab without deleting its shared cookie.
- Anyone with the invitation can join; this is not an authenticated or confidential workspace. Participant names are reserved while their membership is retained.
- Disconnected participants are retained for **five minutes**, using the shared collaboration retention scheduler. Resuming before expiry cancels cleanup and retains identity, ownership, votes, readiness, and role. At expiry, the active membership and its vote selections are removed, its name/capacity are released, and its old token is rejected. Connected participants receive the updated snapshot immediately. Notes and structured action owners retain their original IDs and display-name snapshots; a new participant taking the same name does not own the old content. Cleanup does not change closed rooms.
- A room has at most one moderator. The connected moderator can transfer the role to another connected participant, which immediately removes their own moderator controls. When no moderator is connected, any connected participant can claim the role; commands are serialized in the room service, so the first accepted claim wins and later claims are rejected. If an old moderator reconnects within retention after recovery, they return as a participant and cannot take the role back automatically. If that identity expires, connected participants can still claim the vacant role under the same recovery policy.
- During private writing, only an author can delete their own note; moderators cannot inspect or target writing that was not sent to them. After reveal, the moderator can delete any note during grouping, voting, or discussion with a destructive confirmation. Removing a note removes all votes attached to that note and releases those vote selections.
- A moderator can remove any other participant, including an offline participant, but cannot remove themselves. Removal immediately revokes resume access and closes an active socket. The removed participant's votes are discarded; retained notes keep a stable author-name snapshot, and structured action owners retain a display-name snapshot even after that participant leaves.
- Writing is private by default: write-phase snapshots contain only the receiving participant's notes, with no moderator preview. Advancing to grouping reveals all notes and authors to every participant. During voting, each recipient receives only their own selections and no aggregate totals; discussion/closed snapshots, history, and exports contain anonymous aggregate counts rather than voter IDs. Action items are visible after their phase begins. Only each participant's own reconnect token is sent to their socket.
- Limits: 100 rooms per process, 30 participants per room, 300 notes and 100 actions per room. Names: 3–30 characters; titles: 100; note/action text: 1,000; action owner: 60. Commands are limited to 30 per second per connection; WebSocket payloads to 16 KiB.
- Run one backend instance, or use sticky routing to the same process for all members of a room. Replicas do not share room state. This is intentionally not a durable collaboration service.

## Implementation

- `packages/shared/retrospective.ts`: strict v1 client/server Zod contracts, inferred types, public/archive projections, private state schemas, centralized limits, and the explicit v1/v2-to-v3 archive migration.
- `packages/shared/participant.ts`: domain-neutral participant-name normalization and validation shared by Poker, Retro, and future collaboration domains.
- `apps/backend/src/collaboration`: domain-neutral participant identity, normalized-name validation, roles, presence, reconnect tokens, connection replacement/audience lookup, room registration, and configurable retention scheduling.
- `apps/backend/src/retro/retro.service.ts`: retrospective notes/phases/actions and fixed two-hour expiry policy.
- `apps/backend/src/retro/retro-application.service.ts`: transport-independent command dispatch, sessions, recipient-specific snapshots, replacement, and expiry orchestration. It returns explicit addressed events and close effects.
- `apps/backend/src/retro/retro.gateway.ts`: the transport-only Nest controller for runtime DTO validation, rate-limit delegation, heartbeat registration, application delegation, and response dispatch.
- `apps/backend/src/transport`: shared WebSocket serialization/connection adapters, configurable heartbeat handling, application event dispatch, and keyed throttling. `RetroModule` imports both this module and `CollaborationModule`.
- `apps/frontend/app/retro`: retrospective routes and UI, including the responsive room status card.
- `apps/frontend/hooks/use-retro-socket.ts`: isolated connection, cookie resume lifecycle, and snapshot persistence.
- `apps/frontend/lib/retro-session.ts`: expiring cookie helpers.
- `apps/frontend/lib/retro-history.ts`: versioned, validated, token-free localStorage snapshots. The `retro-history-v1` key format is retained; entries with archive version 1 voter IDs are migrated once into recipient-safe selections or anonymous discussion counts, then rewritten as archive v3.
- `apps/frontend/lib/retro-protocol.ts`: complete nested server-event validation before React state or history updates.
- `apps/frontend/lib/retro-export.ts`: Markdown and plain-text serialization. Exports use the same deliberate secret-free public-room allowlist as history; strict socket validation and archive sanitization remain separate responsibilities.

## Browser history and privacy

- Snapshots are updated on every received room state, including the closing broadcast. During writing, the server sends each browser only that participant's private notes, so in-progress history and exports cannot contain another participant's unrevealed writing. Write-phase archives record their audience so the frontend can filter defensively; older write-phase archives without that marker have their notes removed. History uses a separate `retro-history-v1:<code>:<expiresAt>` entry per room lifetime, so saving one room does not overwrite another. A completed snapshot cannot be replaced by any later snapshot, including another closed broadcast. Its original content and `savedAt` are preserved through reconnect, reload, and presence changes; `closedAt` records actual completion time independently of the browser save time.
- **Completed** entries contain final actions received while connected. Other entries are explicitly labeled as the **last seen** phase and may be incomplete: a disconnected browser cannot receive subsequent changes or the closing broadcast. History is a read-only record, not a second editable or synchronized board.
- History remains after cookie/room expiry or server restart, until deleted or browser storage is cleared/evicted. `/retro/history` does not connect to the retrospective server. The frontend must still be reachable to load the page; this is not a service-worker/offline-app implementation.
- Notes, participant names, anonymous vote totals (after discussion starts), and action owners are stored in this browser profile and visible to anyone using it. There is no login, cross-device sync, or automatic server backup. Use **Delete saved retro** to remove a saved copy; this does not delete the live room. An open live tab receiving further updates can save it again.
- Storage denial/quota failures show a warning without interrupting collaboration. Older entries are not evicted to make space. Corrupt or unsupported entries are skipped with a warning rather than crashing the history page.
- Copy Markdown and `.md`, `.txt`, and `.json` downloads work from a closed live room or any saved history entry without the retro server. The final-step copy distinguishes the browser-local snapshot from a durable exported backup. Exports allowlist public fields and never include resume credentials. Markdown preserves action checkboxes, owners, votes, authors, and multiline text while escaping user Markdown/HTML. Clipboard denial reveals a selectable Markdown field for manual copy.

## Checks

```sh
bun run --cwd apps/frontend test:unit
bun run --cwd apps/backend test
bun run --cwd apps/backend test:e2e
bun run build
bun run lint

# Browser regression (starts backend :4000 and frontend :3001)
cd apps/frontend
bunx playwright install chromium
bun run test:e2e
```

The WebSocket end-to-end tests exercise real clients, room broadcasts, private credentials, permissions, shared reconnect replacement, and coexistence with the original poker endpoint. Cross-domain contract tests prove that Poker and Retro receive the same normalized-name, unique-name, role, token, disconnect, and resume guarantees. Application-service tests cover session orchestration, recipient privacy, audience events, and replacement without constructing sockets. Small gateway/transport contract tests cover DTO validation, serialization, rate limiting, heartbeat cleanup, and protocol wiring; domain service tests cover phase transitions, voting budgets, resource limits, and domain-specific retention/expiry. Bun frontend unit tests cover history updates, separate room lifetimes, corruption/quota handling, credential exclusion, and Markdown output. Browser regression covers separate-profile collaboration, request-specific acknowledgements (unrelated broadcasts cannot clear a pending draft), refresh/reopen identity and moderator recovery, same-profile tab replacement, stale cookies, all phases, saved final history without a live server/token, deletion, Markdown clipboard/download/fallback, connected/disconnected/expiring/storage-failure status, responsive status placement, and dark mode.
