# @bleed-believer/ws

A router-based WebSocket layer for [`ws`](https://github.com/websockets/ws), with
[`path-to-regexp`](https://github.com/pillarjs/path-to-regexp) route matching and
full TypeScript support.

It lets you attach a WebSocket router to any existing HTTP(S) server and dispatch
upgrade requests to handlers based on the request URL — with typed route
parameters, nested routers, and an Express-style `next()` chain.

It also ships `SocketClient`, a WebSocket client driven by an explicit state
machine, with typed events and auto-reconnection you can actually cancel. The
client is published under its own entrypoint and depends on nothing but the
standard `WebSocket` API, so it runs unchanged in the browser — Angular, React,
Vite, or plain ESM — without pulling `ws` or any Node built-in into your bundle.

## Features

- **Attaches to an existing HTTP(S) server** — no separate port, just hooks into
  the server's `upgrade` event.
- **Route matching powered by `path-to-regexp`** — named parameters (`:id`),
  optional groups (`{/:id}`) and named wildcards (`*rest`), using the same
  `path-to-regexp` v8 syntax as Express 5.
- **Typed route parameters** — the shape of `ws.params` is inferred from the
  route string at compile time.
- **Composable routers** — nest `SocketServerRouter` instances and mount them
  under a path prefix, just like an Express `Router`.
- **Middleware-style chaining** — call `next()` to pass a connection to the next
  matching handler instead of claiming it.
- **Sensible connection handling** — unmatched paths get an HTTP `404` before
  the handshake; unclaimed or throwing handlers close the socket with code
  `1011`.
- **Explicit lifecycle** — construction has no side effects; you `bind()` to
  start routing and `close()` to stop, without the class ever taking ownership
  of the HTTP server it attaches to.
- **A client with a real lifecycle too** — `SocketClient` exposes its state as a
  five-state machine, emits typed events, reconnects on its own if you ask it
  to, and lets `close()` cancel a reconnection already in flight instead of
  leaving a retry loop spinning forever.
- **A browser-ready client** — `@bleed-believer/ws/client` is a separate
  entrypoint built on the standard `WebSocket` API, with no Node built-ins and
  no `ws` in its import graph, so a front-end bundle only ships the client.
- **ESM-only, zero runtime deps** besides `path-to-regexp` (server-side only),
  with `ws` as an *optional* peer dependency.

## Installation

For the server (Node.js 20+):

```bash
npm install @bleed-believer/ws ws
```

For the client only — a browser app, e.g. Angular:

```bash
npm install @bleed-believer/ws
```

`ws` is an optional peer dependency: it's required by the server, and never
loaded by the client, so a front-end project can leave it out entirely without
npm complaining.

## Entrypoints

The package exposes three subpaths. **Import from the narrowest one that covers
your use case** — it's what keeps the server out of a browser bundle:

| Import | Contents | Runs on |
| --- | --- | --- |
| `@bleed-believer/ws/client` | `SocketClient` and its types | Browser **and** Node |
| `@bleed-believer/ws/server` | `SocketServer`, `SocketServerRouter` and their types | Node (requires `ws`) |
| `@bleed-believer/ws` | Everything above, re-exported | Node (requires `ws`) |

```ts
// Browser (Angular, React, Vite…) — bundles only the client:
import { SocketClient } from '@bleed-believer/ws/client';

// Node server:
import { SocketServer, SocketServerRouter } from '@bleed-believer/ws/server';
```

In a browser app, always import from `@bleed-believer/ws/client`. The root
entrypoint re-exports the server too, so importing from `@bleed-believer/ws`
drags `ws` and Node built-ins into the module graph and your bundler will fail
to resolve them.

One naming detail: `WebSocketObject` means different things on each side — the
server's decorated `ws` socket vs. the minimal browser-socket shape the client
drives — so the root entrypoint exports **neither**, rather than silently picking
a winner. It's the one name the root doesn't re-export: take it from
`@bleed-believer/ws/client` or `@bleed-believer/ws/server`, whichever side you
mean.

## Quick start

```ts
import { createServer } from 'node:http';
import { SocketServer, SocketServerRouter } from '@bleed-believer/ws/server';

const server = createServer();

const app = new SocketServer({ server })
    .use(new SocketServerRouter()
        .use('/chat/:room', (ws, req, next) => {
            console.log(`New connection to room ${ws.params.room}`);
            ws.on('message', (data) => {
                ws.send(`echo: ${data}`);
            });
        })
    )
    .bind();

server.listen(3000);
```

Any client connecting to `ws://localhost:3000/chat/general` will be handled by
the handler above, with `ws.params.room === 'general'` and `ws.path ===
'/chat/general'`.

The three steps are always the same: **construct** the server around an HTTP(S)
server, **register** one or more `SocketServerRouter`s with `use()`, and
**arm** the routing with `bind()`.

## Core concepts

### `SocketServer`

`SocketServer` is the entry point: it owns the `ws` `WebSocketServer` (in
`noServer` mode) and dispatches upgrade requests to the routers you register.
It extends `EventEmitter`, so you can subscribe to the connection events it
re-emits (see [Events](#events)).

```ts
new SocketServer(options, inject?)
```

- `options` — configuration for the server. It **must** include `server`, the
  HTTP(S) server to attach to, and may include any field from `ws`'s
  `ServerOptions` except the ones this class manages internally (`noServer`,
  `server`, `host`, `port`, `clientTracking`, `path`). `clientTracking` is
  pinned to `true` because `close()` relies on the tracked `clients` set to
  drop every live connection; `path` is stripped because request-path routing
  belongs to this layer, not to `ws`'s own path filter. Useful for things like `maxPayload`,
  `perMessageDeflate` or `verifyClient` (see
  [Security](#security-verifying-the-connection-origin)).
- `inject` — optional dependency overrides, used mainly in tests.

Construction has **no side effects**: it does not touch the HTTP server until
you call `bind()`.

```ts
app.use(router: SocketServerRouter): SocketServer
```

Mounts a router's routes onto the server, in registration order. Returns the
same instance, so it can be chained. To register handlers by path you build a
[`SocketServerRouter`](#socketserverrouter) and pass it here — `SocketServer`
itself only accepts routers.

```ts
app.bind(): SocketServer
```

Attaches the `upgrade` handler to the server, so incoming upgrade requests start
being routed. Safe to call whether or not the server is already listening, and
**idempotent** — calling it more than once never stacks duplicate handlers. For
every upgrade request:

1. The request URL's pathname is matched against every registered route.
2. If **no route matches**, the raw socket is rejected with a plain
   `HTTP/1.1 404 Not Found` response — the WebSocket handshake never happens.
3. If at least one route matches, the handshake completes and the `connection`
   event is emitted. If a `connection` listener **throws**, the error is logged
   with `console.error` and the socket is closed with code `1011` and reason
   `"A connection listener threw an exception"` — the handler chain never runs.
4. Otherwise the matching handlers are invoked **in registration order**, each
   decorated with the route's `params` and `path`.
5. A handler **claims** the connection simply by not calling `next()`. If every
   matching handler calls `next()` (or there simply are none left), the socket
   is closed with code `1011` and reason `"No handler claimed the connection"`.
6. If a handler **throws** (or its returned promise rejects), the error is
   logged with `console.error` and the socket is closed with code `1011` and
   reason `"Handler threw an exception"`.

```ts
app.close(): SocketServer
```

Shuts the socket layer down: detaches the `upgrade` handler (undoing `bind()`)
and closes every live WebSocket connection. The **HTTP server is left
untouched** — this class did not start it, so stopping it is your
responsibility (`server.close()`). After `close()` you can call `bind()` again
to resume routing.

#### Restarting the server

Because `close()` leaves no listeners behind, resuming after a full server
restart is an explicit, one-line opt-in: re-`bind()` whenever the server starts
listening again.

```ts
const app = new SocketServer({ server }).use(router).bind();
server.on('listening', () => app.bind());

// later…
app.close();     // stop routing + drop live connections
server.close();  // you own the HTTP server's lifecycle

// restarting the same server re-arms routing automatically:
server.listen(3000);
```

#### Events

`SocketServer` re-emits the `ws` server events that are meaningful while running
in `noServer` mode:

- `connection` — `(ws, request)`, emitted once a matched upgrade completes its
  handshake, right before the handler chain runs.
- `headers` — `(headers, request)`, emitted while the handshake response
  headers are being built.
- `wsClientError` — `(error, socket, request)`, emitted when a client sends an
  invalid handshake.

```ts
app.on('connection', (ws, req) => {
    console.log('handshake completed for', req.url);
});
```

### `SocketServerRouter`

`SocketServerRouter` is the composable route registry. You register handlers and
sub-routers on it, then mount it on a `SocketServer` with `use()`.

```ts
router.use(callback)
router.use(path, callback)
router.use(subRouter)
router.use(path, subRouter)
```

- `callback` — a `WebSocketCallback<T>`, invoked as `(ws, req, next) =>
  unknown` (sync or `async`; a returned promise is awaited), registered either
  for every path (no `path` argument) or for connections whose URL matches
  `path`.
- `subRouter` — another `SocketServerRouter` instance, optionally mounted under
  a path prefix. Prefixes are concatenated as routers are nested, so a
  sub-router mounted at `/api` that itself registers `/users/:id` resolves to
  `/api/users/:id`.
- `path` is normalized to always start with `/` (`'foo'` and `'/foo'` are
  equivalent).
- `use()` returns `this`, so calls can be chained.

`router.routes()` flattens the registry into the ordered list of
`{ path, callback }` entries that `SocketServer.use()` consumes; you rarely need
to call it yourself.

#### Nesting routers

```ts
import { SocketServer, SocketServerRouter } from '@bleed-believer/ws/server';

const usersRouter = new SocketServerRouter()
    .use('/:id', (ws) => {
        console.log('user id:', ws.params.id);
    })
    .use('/:id/settings', (ws) => {
        console.log('settings for user:', ws.params.id);
    });

const apiRouter = new SocketServerRouter()
    .use('/users', usersRouter);

const app = new SocketServer({ server })
    .use(new SocketServerRouter().use('/api', apiRouter))
    .bind();

// Effective routes:
//   /api/users/:id
//   /api/users/:id/settings
```

#### The `next()` chain

When several registered routes match the same URL, they run in registration
order until one of them claims the connection:

```ts
const router = new SocketServerRouter()
    .use('/admin/:id', (ws, req, next) => {
        if (!isAuthorized(req)) {
            ws.close(4001, 'Unauthorized');
            return; // does not call next() -> chain stops here
        }
        next(); // let the next matching handler take over
    })
    .use('/admin/:id', (ws) => {
        // only reached if the previous handler called next()
        ws.on('message', handleAdminMessage);
    });

new SocketServer({ server }).use(router).bind();
```

If none of the matching handlers call `ws.close()` themselves and all of them
call `next()`, the connection is closed automatically with code `1011`.

### Route parameters and typing

Route parameters are extracted using `path-to-regexp` syntax and are fully
typed via the `RouteParameters<P>` helper, so `ws.params` is inferred straight
from the literal route string — no manual generics required:

```ts
new SocketServerRouter()
    .use('/user/:id/:action', (ws) => {
        // ws.params: { id: string; action: string }
        ws.params.id;
        ws.params.action;
    })
    .use('/user/:id{/:action}', (ws) => {
        // ws.params: { id: string; action?: string }
    })
    .use('/files/*rest', (ws) => {
        // ws.params: { rest: string[] }
        ws.params.rest.join('/');
    });
```

Each connection object (`ws`) is a regular `ws` `WebSocket` instance decorated
with two extra fields:

- `ws.params` — the typed parameters matched from the route.
- `ws.path` — the pathname that was matched (e.g. `/user/555/edit`).

Just like Express's `req.params`, these are a **single mutable reference** that
the router reassigns to the currently executing handler's matched values before
invoking it. While your handler runs, `ws.params` / `ws.path` always describe
its own route; the moment it calls `next()` and control moves on, the same
reference is updated for the next handler. This only matters when you read them
**after** yielding control — inside an `await`, a `setTimeout` or an event
listener. Capture what you need synchronously at the top of the handler:

```ts
new SocketServerRouter()
    .use('/chat/:room', (ws) => {
        const { room } = ws.params; // capture up front
        ws.on('message', (data) => {
            // `room` stays correct here; reading `ws.params.room` inside this
            // listener would reflect whichever handler last ran, as in Express.
            broadcast(room, data);
        });
    });
```

### Pathless handlers

A handler (or sub-router) registered without a `path` argument matches every
URL, and always receives untyped params (`ParamData`, i.e. `Record<string,
string | string[]>`):

```ts
new SocketServerRouter()
    .use((ws, req) => {
        console.log('connection to', ws.path);
    });
```

This is useful for cross-cutting concerns (logging, auth checks) that should
run for every connection ahead of more specific routes — combine it with
`next()` so it doesn't swallow the connection.

#### Prefix-mounting a pathless handler

Mounting a pathless handler (or a router whose handlers are pathless) under a
path prefix scopes that catch-all to the prefix and **everything below it**,
exactly like Express's `app.use('/api', mw)`. The handler still sees the full
request path in `ws.path`, not just the consumed prefix:

```ts
const app = new SocketServer({ server })
    .use(new SocketServerRouter()
        // Runs for `/api` and every subpath (`/api/users`, `/api/a/b`, …),
        // but NOT for siblings outside the prefix (`/public`).
        .use('/api', new SocketServerRouter()
            .use((ws, req, next) => {
                console.log('api hit:', ws.path); // full path, e.g. /api/users
                next();
            })
        )
        .use('/api/users', (ws) => { /* claims /api/users */ })
    )
    .bind();
```

A pathless handler registered **without** a prefix still matches every URL; the
prefix is what narrows it to a subtree.

## `SocketClient`

`SocketClient` is the client side of the package: a thin, typed wrapper around a
standard `WebSocket` that turns its lifecycle into an explicit state machine and
re-emits its events through the same typed `EventEmitter` used across the
package.

It talks to `globalThis.WebSocket` and nothing else, so the same code runs in the
browser and in Node 22+ (which ships a global `WebSocket`). Import it from
`@bleed-believer/ws/client` — see [Entrypoints](#entrypoints).

```ts
import { SocketClient } from '@bleed-believer/ws/client';

const client = new SocketClient('ws://localhost:3000/chat/general', {
    reconnectMs: 1_000,
    timeoutMs: 5_000
});

client.on('socketOpen', () => console.log('connected'));
client.on('socketMessage', (data, origin) => console.log(data, 'from', origin));
client.on('socketError', (error) => console.error(error));
client.on('socketClose', (code, reason, wasClean) => console.log('closed', code));

await client.connect();
client.send('hello');
// …later
await client.close();
```

```ts
new SocketClient(url, options?, inject?)
```

- `url` — the endpoint to connect to, as a `string` or `URL`.
- `options` — see [Options](#options-1) below. Invalid values are rejected at
  construction with a `RangeError`, not silently coerced.
- `inject` — optional dependency overrides (a `WebSocket` constructor), used
  mainly in tests. Defaults to `globalThis.WebSocket`.

Construction has **no side effects**: no socket is opened until you call
`connect()`.

### The state machine

Every client is in exactly one of five states, readable at any time through
`client.status` (and, as a shortcut, `client.listening === (status ===
'CONNECTED')`):

| Status | Meaning |
| --- | --- |
| `CLOSED` | Idle. The only state from which `connect()` is accepted. |
| `CONNECTING` | A handshake requested by `connect()` is in flight. |
| `CONNECTED` | The socket is open; messages flow. |
| `RECONNECTING` | The peer dropped us and `reconnectMs` is set, so retries are in flight. |
| `CLOSING` | A `close()` you requested is waiting for the socket's `close` event. |

Every path back into `CLOSED` — a failed handshake, a deliberate `close()`, a
drop the client gives up on — funnels through the same teardown, which detaches
every listener and releases the socket. **A client that reaches `CLOSED` is
always reusable**: calling `connect()` again on it opens a fresh connection.

### Lifecycle

```ts
await client.connect(): Promise<void>
```

Opens the connection and resolves once the handshake completes. It **rejects**
(never throws synchronously) if the handshake fails, if `timeoutMs` elapses
first, or if the client isn't `CLOSED` — so a single `.catch()` covers every
failure mode. A rejected `connect()` leaves the client back in `CLOSED`, ready
to be retried.

```ts
await client.close(): Promise<void>
```

Closes the connection and resolves once the client has actually reached
`CLOSED`. It's valid from any state except `CLOSED` (which rejects with *"already
closed"*), and it does the right thing in each one:

- from `CONNECTING`, it aborts the in-flight handshake (the pending `connect()`
  rejects);
- from `CONNECTED`, it closes the socket and waits for the real `close` event;
- from `RECONNECTING`, it **cancels the retry loop** — including a retry that is
  currently sleeping between attempts, which is woken up immediately rather than
  waited out;
- from `CLOSING`, it joins the close already in progress instead of starting a
  second one.

```ts
client.send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void
```

Writes a frame to the peer. It's only legal while `CONNECTED`, and **throws**
from any other status rather than dropping the frame on the floor. That includes
`RECONNECTING`: nothing is buffered across connections, so a client that is
retrying will refuse the write instead of pretending it went out. If you need
writes to survive a drop, queue them yourself and flush on `socketOpen`, which
fires again on every successful reconnection.

```ts
client.on('socketOpen', () => {
    for (const frame of outbox.splice(0)) {
        client.send(frame);
    }
});
```

### Events

| Event | Payload | When |
| --- | --- | --- |
| `socketOpen` | — | Every time a connection is established, including each successful reconnection. |
| `socketMessage` | `(data, origin)` | An inbound frame. `data` is typed from `messageType` (see below). |
| `socketError` | `(error: Error)` | A transport error while connected, and once per failed reconnection attempt. |
| `socketClose` | `(code, reason, wasClean)` | The connection is over **for good** — emitted exactly once per connection. |

The important subtlety is `socketClose`: it fires when the client lands in
`CLOSED`, **not** every time the underlying socket drops. If `reconnectMs` is
set and a retry succeeds, the consumer is never told the connection was lost —
which is the whole point of asking for auto-reconnection. `socketClose` only
arrives once the client gives up (i.e. you called `close()`) or when
reconnection is off.

### Reconnection

Set `reconnectMs` and an unsolicited drop starts a retry loop: the client keeps
attempting to reconnect, waiting `reconnectMs` between attempts, emitting
`socketError` on each failure, until it gets back in — or until `close()` cancels
it.

```ts
const client = new SocketClient('ws://localhost:3000/feed', { reconnectMs: 1_000 });

await client.connect();

// The server goes away. The client silently retries every second, and emits
// `socketOpen` again once it's back. No `socketClose` in between.

await client.close(); // stops the loop, even mid-retry, and resolves
```

The retry delay is **fixed**, not exponential, and there's no jitter: if a
fleet of clients loses the same server, they all come back at the same cadence.
Pick a `reconnectMs` that your server can absorb. `0` is accepted, but it retries
as fast as the runtime allows and will hammer the peer — it must be a deliberate
choice, which is why a `NaN` or a negative value is a `RangeError` instead of
quietly behaving like `0`.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `messageType` | `'string' \| 'arraybuffer' \| 'blob'` | `'string'` | Sets the socket's `binaryType` and, more usefully, the type of `data` in `socketMessage`. |
| `reconnectMs` | `number` | — | Milliseconds between reconnection attempts after an unsolicited drop. Omit it to not reconnect at all. Must be an integer `>= 0`. |
| `timeoutMs` | `number` | — | How long a handshake may take before `connect()` gives up. Omit it and a peer that accepts the TCP connection but never completes the upgrade keeps `connect()` pending forever. Must be an integer `> 0`. |
| `protocols` | `string[]` | — | Subprotocols offered during the handshake. |

### Typed messages

`messageType` isn't just a runtime flag: the payload of `socketMessage` is
inferred from it, so binary streams don't need a cast.

```ts
const text = new SocketClient('ws://localhost:3000/feed');
text.on('socketMessage', (data) => {
    // data: string
});

const binary = new SocketClient('ws://localhost:3000/feed', {
    messageType: 'arraybuffer'
});
binary.on('socketMessage', (data) => {
    // data: ArrayBuffer
});
```

## Security: verifying the connection origin

Like `ws` (and browsers' WebSocket API), this server does **not** validate the
`Origin` header by default. Because browsers do not enforce the same-origin
policy on WebSocket handshakes, any web page a user visits can open a connection
to your server and ride along with the user's cookies — a
[Cross-Site WebSocket Hijacking](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_WebSocket_Hijacking_Cheat_Sheet.html)
(CSWSH) attack. If your handlers rely on ambient/cookie authentication, you
should reject unexpected origins.

Pass a `verifyClient` hook through the constructor options — it is forwarded
straight to the underlying `ws` `WebSocketServer` and is honored during the
handshake, so the upgrade is rejected before any handler runs:

```ts
const ALLOWED = new Set([ 'https://app.example.com' ]);

const app = new SocketServer({
    server,
    // `ws` types `verifyClient` as a sync/async union, so annotate the
    // parameter — TypeScript can't infer it across the union on its own.
    verifyClient: (info: { origin: string }) => {
        // Reject browsers coming from an unexpected origin. Note that
        // non-browser clients can spoof or omit `Origin`, so treat this as
        // defense against CSWSH, not as authentication on its own.
        return !info.origin || ALLOWED.has(info.origin);
    }
})
    .use(new SocketServerRouter().use('/chat/:room', (ws) => { /* ... */ }))
    .bind();
```

When `verifyClient` returns `false`, the client receives an HTTP `401` and the
handshake is aborted. For real authentication, still validate a token/session
inside your handler (or a pathless handler ahead of the route) rather than
trusting `Origin` alone.

Note that `verifyClient` only runs **once a route matches**: route matching
happens first, and a request to an unregistered path is rejected with a `404`
before the handshake begins, so the hook never sees it. This is not a gap —
unmatched paths are already refused — but it means `verifyClient` gates the
handshake of matched routes, not every incoming upgrade. Register a pathless
handler if you need origin/auth logic to run for **every** matched connection
regardless of route.

## API reference

Every export below is also re-exported from the root entrypoint, **except
`WebSocketObject`** — the one name that means something different on each side,
so it's only reachable from `/client` or `/server`.

| Export | Entrypoint | Description |
| --- | --- | --- |
| `SocketServer` | `/server` | Router-based server; `use(router)` mounts routes, `bind()` starts routing on the HTTP(S) server passed at construction, `close()` detaches and drops live connections. Extends `EventEmitter`. |
| `SocketServerRouter` | `/server` | Composable route registry (`use`, `routes`). |
| `RouteParameters<P>` | `/server` | Type helper inferring the params object for a route pattern `P`. |
| `Server` | `/server` | Minimal `EventEmitter` shape (an `upgrade` event) required by `SocketServer`'s `server` option. |
| `SocketServerOptions` | `/server` | Options accepted by `SocketServer`'s constructor: the required `server` plus a subset of `ws`'s `ServerOptions`. |
| `WebSocketObject<T>` | `/server` **only** | A `ws` `WebSocket` decorated with the matched `path` and typed `params`. Not re-exported from the root — see the note above. |
| `WebSocketCallback<T>` | `/server` | Handler signature: `(ws, req, next) => unknown`. |
| `SocketClient<T>` | `/client` | Reconnecting WebSocket client; `connect()` opens, `send(data)` writes, `close()` closes (cancelling a reconnection in flight), `status` / `listening` expose the state machine. Extends `EventEmitter`. |
| `SocketClientOptions` | `/client` | Options accepted by `SocketClient`'s constructor: `messageType`, `reconnectMs`, `timeoutMs`, `protocols`. |
| `SocketClientStatus` | `/client` | The five states: `'CLOSED' \| 'CONNECTING' \| 'CONNECTED' \| 'RECONNECTING' \| 'CLOSING'`. |
| `SocketClientMessageType<T>` | `/client` | Type helper resolving the `socketMessage` payload from the `messageType` option. |
| `SocketClientEventEmitter<T>` | `/client` | The client's typed event map (`socketOpen`, `socketMessage`, `socketError`, `socketClose`). |
| `SocketClientInject` | `/client` | Dependency overrides for `SocketClient` (a `WebSocket` constructor), used mainly in tests. |
| `WebSocketObject` | `/client` **only** | The minimal browser-`WebSocket` shape the client drives. Not re-exported from the root — see the note above. |

## License

MIT © BleedBeliever
