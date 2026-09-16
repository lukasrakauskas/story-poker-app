# Retrospective session security

Retrospective membership is anonymous, room-scoped, and intentionally short-lived. A
resume credential can restore note authorship and moderator authority, so it is
handled as a bearer secret even though no account is required.

## Session flow and topology

The backend origin is the sole owner of `retro-session-<room-code>`. The cookie is
`HttpOnly; Secure; SameSite=None; Path=/retro`, expires with the room, and is never
read by frontend JavaScript. The frontend uses `credentials: "include"` for these
backend HTTP operations:

- `POST /retro/session` establishes a new `create` or `join` session and sets the
  cookie. Joining always creates the requested identity; it never silently
  resumes a different identity. The UI offers explicit Continue or Forget first.
- `POST /retro/session/:code/resume` validates the current cookie, rotates it,
  invalidates the previous socket, and sets the replacement cookie.
- `GET /retro/session/:code` returns only remembered name/role metadata without
  rotating, attaching a socket, or exposing/persisting room content.
- `DELETE /retro/session/:code` explicitly forgets and revokes the session, closes
  its socket, and expires the cookie.

An anonymous socket may inspect room availability. After HTTP establishment or
resume the browser opens a fresh authenticated WebSocket. The socket
sends `{ type: "resume", code }`; the gateway reads the cookie captured during the
upgrade and passes the credential to the application service. A second direct
socket using an already-active cookie is rejected; HTTP resume is the operation
that rotates and replaces an active connection. `retro-state` only
contains `self.id`; it never contains a token. Failed resume/forget requests do not
clear cookies, which prevents a delayed response or a displaced tab from deleting
a newer shared-browser cookie.

Configure the backend `RETRO_ALLOWED_ORIGINS` as a comma-separated exact-origin
allowlist (required in production; development/test use localhost defaults), for
example:

```text
RETRO_ALLOWED_ORIGINS=https://retro.example,https://www.retro.example
```

The same policy is used for HTTP CORS, HTTP session endpoint origin checks, and
retrospective WebSocket `Origin` checks. Requests without an `Origin` are allowed
for non-browser clients; browser origins must match the list. Credentials require
`Access-Control-Allow-Credentials`; wildcard origins are never used. The cookie remains host-only on the backend origin, so the frontend must not
attempt to inspect it. `NEXT_PUBLIC_WS_URL` identifies the WebSocket backend and
`NEXT_PUBLIC_RETRO_API_URL` may be set when the HTTP backend origin cannot be
derived from it. Use HTTPS/WSS in deployed environments; `Secure` is unconditional
on the session cookie.

Configure `RETRO_STORAGE=redis` and a shared `RETRO_REDIS_URL` for multiple replicas.
Room updates, hashed credentials, rotation, revocation and connection ownership
are atomically committed in Redis; pub/sub coordinates socket displacement.
HTTP and WebSocket requests may reach different replicas. Memory mode remains
single-process and loses rooms on restart.

HTTP session responses are `Cache-Control: no-store`. Browser session operations
use Web Locks to serialize successful Set-Cookie responses across same-origin
tabs; without Web Locks only same-tab ordering is available. Server-side atomic
rotation still rejects replay, but browsers without cross-tab locks should avoid
concurrent session changes across tabs. No retry replays an uncertain mutation.

## Threat model and limits

- **Frontend XSS:** XSS cannot read the HttpOnly cookie or obtain it from room
  snapshots, history, exports, analytics, or application logs. XSS can still act as
  the current browser while it is open, so normal output escaping, CSP, dependency
  hygiene, and short room lifetimes remain necessary. An XSS attacker can also
  invoke the explicit forget endpoint; it cannot recover the secret afterward.
- **Cross-site WebSocket requests:** browsers attach eligible cookies to a WebSocket
  upgrade, so the backend rejects every browser `Origin` outside the exact
  allowlist. The room code in the command selects the cookie name, and the domain
  service verifies that cookie against the member in that same room. A cookie for
  room A cannot resume room B.
- **Shared devices and tabs:** anyone with access to the browser profile can use its
  room session, and the cookie is deliberately shared by same-origin tabs. A newer
  HTTP resume rotates the credential and displaces the old socket. The old tab has
  no JavaScript cookie deletion capability; a rejected stale socket therefore
  cannot erase the newer tab's valid cookie. Reopening a room only inspects the
  saved identity; choosing Continue explicitly performs last-connection-wins
  replacement. Forget requires confirmation explaining lost ownership/role access.
- **Token replay/theft:** the long-lived value is not exposed to JavaScript or wire
  state. Every HTTP resume rotates it, and the displaced value is rejected for
  WebSocket attach and mutations. Removal, forget, offline-member expiry, room
  expiry revoke access. Application restart preserves Redis-backed sessions;
  memory-mode restart revokes them by losing the room. A captured cookie can still be used
  before the legitimate owner rotates it; this is inherent to anonymous bearer
  sessions and is reduced, not eliminated, by HttpOnly storage and rotation.
- **Separate origins/topology:** a frontend origin is not trusted merely because it
  can reach the backend. Exact CORS and WebSocket origin configuration is required;
  `SameSite=None` is used because a genuinely cross-site frontend must send the
  backend cookie. TLS protects the cookie and WebSocket in transit. A proxy must
  preserve `Origin`, `Cookie`, and `Set-Cookie`, and route HTTP and WS to replicas
  sharing the configured Redis namespace. Browser privacy settings may block third-party
  cookies even with `SameSite=None`; proxy the backend under the same site when
  that deployment policy applies.
- **Transport leakage:** application services construct recipient-specific public
  snapshots. Gateways and controllers delegate rather than implementing room
  authorization. Tests assert that state, errors, local history, and exports do not
  contain reconnect secrets or server-only voter IDs. Avoid request logging that
  includes `Cookie` or `Set-Cookie` headers.

This is not account authentication, invitation secrecy, or protection against a
compromised browser profile. For sensitive retrospectives, use an authenticated
front door, protected rooms, conservative history retention, and operationally
secured Redis storage. Per-process admission controls should be supplemented by
an edge-wide rate limiter when horizontally scaling.
