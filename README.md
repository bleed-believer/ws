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
import { SocketServer } from '@bleed-believer/ws';

const httpServer = createServer();

const wsServer = new SocketServer()
    .use('/chat/:room', (ws, req, next) => {
        console.log(`New connection to room ${ws.params.room}`);
        ws.on('message', (data) => {
            ws.send(`echo: ${data}`);
        });
    });

wsServer.bootstrap(httpServer);
httpServer.listen(3000);
```

Any client connecting to `ws://localhost:3000/chat/general` will be handled by
the handler above, with `ws.params.room === 'general'` and `ws.path ===
'/chat/general'`.

## Core concepts

### `SocketServer`

`SocketServer` extends `SocketServerRouter` and adds the `bootstrap()` method
that wires the router into a real HTTP(S) server.

```ts
new SocketServer(options?)
```

- `options` — forwarded to the underlying `ws` `WebSocketServer`, based on
  `ws`'s `ServerOptions` with the fields that `SocketServer` manages internally
  removed (`noServer`, `host`, `port`, `WebSocket`). Useful for things like
  `maxPayload` or `perMessageDeflate`.

```ts
wsServer.bootstrap(server: Server): WebSocketServer
```

Attaches an `upgrade` listener to `server` (any `EventEmitter` exposing
`upgrade` and `close`, e.g. `http.Server` / `https.Server`). For every upgrade
request:

1. The request URL's pathname is matched against every registered route.
2. If **no route matches**, the raw socket is rejected with a plain
   `HTTP/1.1 404 Not Found` response and destroyed — the WebSocket handshake
   never happens.
3. If at least one route matches, the handshake completes and the matching
   handlers are invoked **in registration order**, each decorated with the
   route's `params` and `path`.
4. A handler **claims** the connection simply by not calling `next()`. If every
   matching handler calls `next()` (or there simply are none left), the socket
   is closed with code `1011` and reason `"No handler claimed the connection"`.
5. If a handler **throws** (or its returned promise rejects), the error is
   logged with `console.error` and the socket is closed with code `1011` and
   reason `"Handler threw an exception"`.

The `upgrade` listener is automatically removed when the underlying server
emits `close`.

`bootstrap()` returns the `ws` `WebSocketServer` instance it creates, so you can
interact with it directly (e.g. listen to its events or close it).

### `SocketServerRouter`

`SocketServerRouter` is the composable route registry. `SocketServer` inherits
from it, so everything below also applies directly to `SocketServer` instances.

```ts
router.use(callback)
router.use(path, callback)
router.use(subRouter)
router.use(path, subRouter)
```

- `callback` — a `WebSocketCallback<T>`, invoked as `(ws, req, next) => void |
  Promise<void>`, registered either for every path (no `path` argument) or for
  connections whose URL matches `path`.
- `subRouter` — another `SocketServerRouter` instance, optionally mounted under
  a path prefix. Prefixes are concatenated as routers are nested, so a
  sub-router mounted at `/api` that itself registers `/users/:id` resolves to
  `/api/users/:id`.
- `path` is normalized to always start with `/` (`'foo'` and `'/foo'` are
  equivalent).
- `use()` returns `this`, so calls can be chained.

Each call to `use()` returns the router/server instance, so you can chain
registrations fluently, as shown in the [Quick start](#quick-start).

#### Nesting routers

```ts
import { SocketServerRouter, SocketServer } from '@bleed-believer/ws';

const usersRouter = new SocketServerRouter()
    .use('/:id', (ws) => {
        console.log('user id:', ws.params.id);
    })
    .use('/:id/settings', (ws) => {
        console.log('settings for user:', ws.params.id);
    });

const apiRouter = new SocketServerRouter()
    .use('/users', usersRouter);

const wsServer = new SocketServer()
    .use('/api', apiRouter);

// Effective routes:
//   /api/users/:id
//   /api/users/:id/settings
```

#### The `next()` chain

When several registered routes match the same URL, they run in registration
order until one of them claims the connection:

```ts
new SocketServer()
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
```

If none of the matching handlers call `ws.close()` themselves and all of them
call `next()`, the connection is closed automatically with code `1011`.

### Route parameters and typing

Route parameters are extracted using `path-to-regexp` syntax and are fully
typed via the `RouteParameters<P>` helper, so `ws.params` is inferred straight
from the literal route string — no manual generics required:

```ts
new SocketServer()
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
new SocketServer()
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
new SocketServer()
    .use((ws, req) => {
        console.log('connection to', ws.path);
    });
```

This is useful for cross-cutting concerns (logging, auth checks) that should
run for every connection ahead of more specific routes — combine it with
`next()` so it doesn't swallow the connection.

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

const wsServer = new SocketServer({
    verifyClient: ({ origin, req }) => {
        // Reject browsers coming from an unexpected origin. Note that
        // non-browser clients can spoof or omit `Origin`, so treat this as
        // defense against CSWSH, not as authentication on its own.
        return !origin || ALLOWED.has(origin);
    }
})
    .use('/chat/:room', (ws) => { /* ... */ });
```

When `verifyClient` returns `false`, the client receives an HTTP `401` and the
handshake is aborted. For real authentication, still validate a token/session
inside your handler (or a pathless handler ahead of the route) rather than
trusting `Origin` alone.

## API reference

| Export | Description |
| --- | --- |
| `SocketServer` | Router-based server; `bootstrap(server)` attaches it to an HTTP(S) server and returns the created `WebSocketServer`. |
| `SocketServerRouter` | Composable route registry (`use`, `routes`); base class of `SocketServer`. |
| `RouteParameters<P>` | Type helper inferring the params object for a route pattern `P`. |
| `Server` | Minimal `EventEmitter` shape (`upgrade`, `close`) required by `bootstrap`. |
| `SocketServerOptions` | Options accepted by `SocketServer`'s constructor (subset of `ws`'s `ServerOptions`). |
| `WebSocketObject<T>` | A `ws` `WebSocket` decorated with the matched `path` and typed `params`. |
| `WebSocketCallback<T>` | Handler signature: `(ws, req, next) => unknown`. |

## License

MIT © BleedBeliever
