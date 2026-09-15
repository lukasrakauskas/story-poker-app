# Planning Poker WebSocket commands

Planning Poker clients send JSON messages shaped as:

```json
{ "event": "create-room", "data": { "name": "Alice" } }
```

Every command body is validated at runtime. Object bodies reject unknown fields.
Invalid, missing, incorrectly typed, or oversized fields produce the stable response:

```json
{
  "event": "invalid-command",
  "data": { "error": "Invalid command payload." }
}
```

An invalid command does not close the WebSocket, change room state, or call room
services. The client can correct the payload and continue on the same connection.

## Payload limits

| Command             | Data                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `keep-alive`        | omitted                                                                                                                                        |
| `inspect-room`      | `room`: 1–64 characters                                                                                                                        |
| `create-room`       | `name`: at most 128 input characters; optional `cardSet`: at most 30 unique 1–20 character values; optional `password`: at most 100 characters |
| `join-room`         | `name`: at most 128 input characters; `room`: 1–64 characters; optional `password`: at most 100 characters                                     |
| `reconnect`         | `token` and `room`: 1–64 characters each                                                                                                       |
| `cast-vote`         | `vote`: `null` or at most 20 characters                                                                                                        |
| `reveal-results`    | omitted                                                                                                                                        |
| `start-voting`      | omitted                                                                                                                                        |
| `claim-moderator`   | omitted                                                                                                                                        |
| `promote-user`      | `userId`: 1–64 characters                                                                                                                      |
| `kick-user`         | `userId`: 1–64 characters                                                                                                                      |
| `change-avatar`     | `avatar`: non-negative safe integer                                                                                                            |
| `broadcast-message` | `roomId`: 1–64 characters; `message`: 1–1000 non-whitespace characters; `password`: at most 256 characters                                     |

Participant names receive additional domain validation after command validation:
surrounding spaces are removed and the normalized name must contain 3–30
characters. Name normalization, case-insensitive uniqueness, participant roles,
presence, reconnect tokens, connection replacement, room-code registration, and
retention scheduling come from the domain-neutral `CollaborationModule` also used
by retrospectives. Poker supplies its own five-minute offline-participant and
15-minute empty-room retention policies; votes, card sets, avatars, passwords,
and wire response names remain Poker-specific.

## Application and transport boundary

- `apps/backend/src/poker/poker.gateway.ts` is the Nest/WebSocket controller. It validates command DTOs, delegates one application use case, and applies transport results; the old `events.gateway.ts` and `EventsModule` have been removed.
- `PokerApplicationService` owns room/session orchestration and returns explicit requester responses, recipient-addressed events, and connection-close effects without importing `WebSocket`.
- `apps/backend/src/transport` owns socket registration/serialization, heartbeat policy, and keyed rate limits. `ConnectionRegistryService` owns connection replacement and audience lookup by opaque connection ID.
- Poker domain transitions remain in `RoomService`. Application-service tests exercise use cases without sockets, small gateway tests cover DTO/transport delegation, and transport adapter tests cover serialization, close effects, heartbeat, and throttling.
