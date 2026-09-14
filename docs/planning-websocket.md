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
characters.
