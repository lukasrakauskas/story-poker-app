# Short-lived retrospectives

Visit `/retro` to create a room, or share `/retro/<code>` to invite participants. This is independent of the planning-poker routes and uses a separate WebSocket endpoint at `/retro` on the backend origin configured by `NEXT_PUBLIC_WS_URL`.

## Flow

1. **Write:** everyone adds notes under Went well, To improve, or Ideas. Each participant receives only their own notes during this phase, including after reconnecting; moderators do not see anyone else's writing. Only the author can edit/delete a note.
2. **Vote:** the moderator advances the room, revealing the complete attributed board to everyone in the same phase transition. Each person has three votes, at most one per note; clicking again removes a vote so it can be moved.
3. **Discuss:** the moderator advances again, reviews the ranked notes, and creates action items with an owner. The moderator can mark actions done or delete them.
4. **Closed:** the moderator closes the retrospective. The board stays read-only until it expires. Connected browsers save the completed snapshot, including final action owners and completion status.
5. **Previous retrospectives:** open `/retro/history` to read saved notes, participants, and action items without an account or a live room. Copy Markdown or download Markdown, text, or JSON from either a live room or saved history.

## Lifetime and limitations

- Live collaboration still exists **only in backend process memory**. There is no server database or disk persistence. Each participating browser separately saves token-free snapshots in localStorage.
- Rooms expire **two hours after creation**, even if active. Expired rooms reject commands immediately and are swept every 30 seconds. A server restart loses all rooms.
- Reconnection credentials are stored in one host-only cookie per room (`retro-session-<code>`, `Path=/retro`, `SameSite=Lax`, `Secure` on HTTPS). Cookies expire with the room, not with the tab, and are never stored in localStorage. Reopening the room link restores the same identity, note ownership, votes, and moderator access while the live room exists. Joining a remembered room by code also resumes that identity.
- Cookies are JavaScript-readable, **not HttpOnly**: the existing WebSocket protocol explicitly sends the credential in a resume command rather than authenticating through HTTP cookies. This is not an XSS-hardening change. Invalid/expired credentials are cleared; rejected resumes do not silently create a new identity. Opening the same room in another tab moves the live connection to that tab without deleting its shared cookie.
- Anyone with the invitation can join; this is not an authenticated or confidential workspace. Participant names are reserved for the lifetime of the room. There is no moderator transfer/recovery.
- Writing is private by default: write-phase snapshots contain only the receiving participant's notes, with no moderator preview. Advancing to voting reveals all notes and authors to every participant. Voter identities and action items are visible after the relevant phases begin. Only each participant's own reconnect token is sent to their socket.
- Limits: 100 rooms per process, 30 participants per room, 300 notes and 100 actions per room. Names: 3–30 characters; titles: 100; note/action text: 1,000; action owner: 60. Commands are limited to 30 per second per connection; WebSocket payloads to 16 KiB.
- Run one backend instance, or use sticky routing to the same process for all members of a room. Replicas do not share room state. This is intentionally not a durable collaboration service.

## Implementation

- `packages/shared/retrospective.ts`: client/server protocol types.
- `apps/backend/src/retro`: command validation, in-memory service, WebSocket transport and cleanup.
- `apps/frontend/app/retro`: retrospective routes and UI.
- `apps/frontend/hooks/use-retro-socket.ts`: isolated connection, cookie resume lifecycle, and snapshot persistence.
- `apps/frontend/lib/retro-session.ts`: expiring cookie helpers.
- `apps/frontend/lib/retro-history.ts`: versioned, validated, token-free localStorage snapshots.
- `apps/frontend/lib/retro-export.ts`: Markdown and plain-text serialization.

## Browser history and privacy

- Snapshots are updated on every received room state, including the closing broadcast. During writing, the server sends each browser only that participant's private notes, so in-progress history and exports cannot contain another participant's unrevealed writing. Write-phase archives record their audience so the frontend can filter defensively; older write-phase archives without that marker have their notes removed. History uses a separate `retro-history-v1:<code>:<expiresAt>` entry per room lifetime, so saving one room does not overwrite another. A completed snapshot cannot be replaced by an older non-final snapshot.
- **Completed** entries contain final actions received while connected. Other entries are explicitly labeled as the **last seen** phase and may be incomplete: a disconnected browser cannot receive subsequent changes or the closing broadcast. History is a read-only record, not a second editable or synchronized board.
- History remains after cookie/room expiry or server restart, until deleted or browser storage is cleared/evicted. `/retro/history` does not connect to the retrospective server. The frontend must still be reachable to load the page; this is not a service-worker/offline-app implementation.
- Notes, participant names, votes, and action owners are stored in this browser profile and visible to anyone using it. There is no login, cross-device sync, or automatic server backup. Use **Delete saved retro** to remove a saved copy; this does not delete the live room. An open live tab receiving further updates can save it again.
- Storage denial/quota failures show a warning without interrupting collaboration. Older entries are not evicted to make space. Corrupt or unsupported entries are skipped with a warning rather than crashing the history page.
- Copy Markdown and `.md`, `.txt`, and `.json` downloads work from live or saved snapshots without the retro server. Exports allowlist public fields and never include resume credentials. Markdown preserves action checkboxes, owners, votes, authors, and multiline text while escaping user Markdown/HTML. Clipboard denial reveals a selectable Markdown field for manual copy.

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

The WebSocket end-to-end tests exercise real clients, room broadcasts, private credentials, permissions, reconnect replacement, and coexistence with the original poker endpoint. Service/gateway unit tests cover phase transitions, voting budgets, validation, resource limits, expiry, and heartbeat cleanup. Bun frontend unit tests cover history updates, separate room lifetimes, corruption/quota handling, credential exclusion, and Markdown output. Browser regression covers separate-profile collaboration, request-specific acknowledgements (unrelated broadcasts cannot clear a pending draft), refresh/reopen identity and moderator recovery, same-profile tab replacement, stale cookies, all phases, saved final history without a live server/token, deletion, Markdown clipboard/download/fallback, storage failures, and mobile/dark mode.
