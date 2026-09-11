# Short-lived retrospectives

Visit `/retro` to create a room, or share `/retro/<code>` to invite participants. This is independent of the planning-poker routes and uses a separate WebSocket endpoint at `/retro` on the backend origin configured by `NEXT_PUBLIC_WS_URL`.

## Flow

1. **Write:** everyone adds notes under Went well, To improve, or Ideas. Notes and authors are visible to the room immediately. Only the author can edit/delete a note.
2. **Vote:** the moderator advances the room. Each person has three votes, at most one per note; clicking again removes a vote so it can be moved.
3. **Discuss:** the moderator advances again, reviews the ranked notes, and creates action items with an owner. The moderator can mark actions done or delete them.
4. **Closed:** the moderator closes the retrospective. The board stays read-only until it expires.

## Lifetime and limitations

- All rooms, notes, votes, participants, and actions exist **only in backend process memory**. There is no database, disk persistence, or browser storage.
- Rooms expire **two hours after creation**, even if active. Expired rooms reject commands immediately and are swept every 30 seconds. A server restart loses all rooms.
- Reconnection credentials live only in the open page's memory. A transient connection loss can resume the same identity; refreshing or closing the page loses the credential, including moderator access. Keep the moderator tab open.
- Anyone with the invitation can join; this is not an authenticated or confidential workspace. Participant names are reserved for the lifetime of the room. There is no moderator transfer/recovery.
- Notes, authors, voter identities, and action items are visible to all participants. Only each participant's own reconnect token is sent to their socket.
- Limits: 100 rooms per process, 30 participants per room, 300 notes and 100 actions per room. Names: 3–30 characters; titles: 100; note/action text: 1,000; action owner: 60. Commands are limited to 30 per second per connection; WebSocket payloads to 16 KiB.
- Run one backend instance, or use sticky routing to the same process for all members of a room. Replicas do not share room state. This is intentionally not a durable collaboration service.

## Implementation

- `packages/shared/retrospective.ts`: client/server protocol types.
- `apps/backend/src/retro`: command validation, in-memory service, WebSocket transport and cleanup.
- `apps/frontend/app/retro`: retrospective routes and UI.
- `apps/frontend/hooks/use-retro-socket.ts`: isolated connection and in-memory session lifecycle.

## Checks

```sh
bun run --cwd apps/backend test
bun run --cwd apps/backend test:e2e
bun run build
bun run lint

# Browser regression (starts backend :4000 and frontend :3001)
cd apps/frontend
bunx playwright install chromium
bun run test:e2e
```

The WebSocket end-to-end tests exercise real clients, room broadcasts, private credentials, permissions, reconnect replacement, and coexistence with the original poker endpoint. Service/gateway unit tests cover phase transitions, voting budgets, validation, resource limits, expiry, and heartbeat cleanup. The browser regression covers two-tab collaboration, request-specific acknowledgements (unrelated broadcasts cannot clear a pending draft), reconnect, all phases, exports, mobile/dark mode, and loss of session identity on reload.
