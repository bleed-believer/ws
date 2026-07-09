# @bleed-believer/ws

A router-based WebSocket layer for [`ws`](https://github.com/websockets/ws), with
[`path-to-regexp`](https://github.com/pillarjs/path-to-regexp) route matching and
full TypeScript support.

It lets you attach a WebSocket router to any existing HTTP(S) server and dispatch
upgrade requests to handlers based on the request URL — with typed route
parameters, nested routers, and an Express-style `next()` chain.

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
- **ESM-only, zero runtime deps** besides `path-to-regexp`, with `ws` as a peer
  dependency.

## Installation

```bash
npm install @bleed-believer/ws ws
```

`ws` is a peer dependency, so it must be installed alongside this package.
Node.js 20+ is required.

## Quick start

```ts
import { createServer } from 'node:http';
import { SocketServer, SocketServerRouter } from '@bleed-believer/ws';

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
import { SocketServer, SocketServerRouter } from '@bleed-believer/ws';

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

| Export | Description |
| --- | --- |
| `SocketServer` | Router-based server; `use(router)` mounts routes, `bind()` starts routing on the HTTP(S) server passed at construction, `close()` detaches and drops live connections. Extends `EventEmitter`. |
| `SocketServerRouter` | Composable route registry (`use`, `routes`). |
| `RouteParameters<P>` | Type helper inferring the params object for a route pattern `P`. |
| `Server` | Minimal `EventEmitter` shape (an `upgrade` event) required by `SocketServer`'s `server` option. |
| `SocketServerOptions` | Options accepted by `SocketServer`'s constructor: the required `server` plus a subset of `ws`'s `ServerOptions`. |
| `WebSocketObject<T>` | A `ws` `WebSocket` decorated with the matched `path` and typed `params`. |
| `WebSocketCallback<T>` | Handler signature: `(ws, req, next) => unknown`. |

## License

MIT © BleedBeliever
