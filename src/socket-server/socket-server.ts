import type { MatchFunction, MatchResult, ParamData } from 'path-to-regexp';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import type { Server, SocketServerOptions, WebSocketCallback, WebSocketObject, SocketServerInject, WebSocketServerEventMap } from './interfaces/index.js';
import type { SocketServerRouter } from '../socket-server-router/index.js';

import { WebSocketServer } from 'ws';
import EventEmitter from 'node:events';

import { createRouteMatcher } from '../route-matcher/index.js';

/**
 * Router-based WebSocket server that attaches to an existing HTTP(S)
 * server's `upgrade` event and dispatches each upgrade request to the
 * handlers registered through {@link use}, matching the connection's URL
 * against `path-to-regexp` route patterns.
 *
 * The target server is supplied up front through
 * {@link SocketServerOptions.server}, but construction has no side effects:
 * call {@link bind} to start routing upgrade requests and {@link close} to
 * detach and tear the server and its live connections down.
 */
export class SocketServer extends EventEmitter<WebSocketServerEventMap> {
    #upgradeCallback = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        // Extract the path exactly as Express 5's `parseurl` does: strip
        // the query string and nothing else. The WHATWG `URL` parser is
        // deliberately avoided here because it normalizes dot-segments
        // (`/a/../b` → `/b`) and resolves protocol-relative/absolute
        // request-targets (`//host/bar` → `/bar`), which would let a
        // request reach a route it does not literally match and diverge
        // from Express's route parsing.
        const path = (req.url ?? '/').replace(/\?.*$/, '');
        const queue: {
            result: MatchResult<ParamData>;
            callback: WebSocketCallback<ParamData>;
        }[] = [];

        for (const { matchFn, callback } of this.#routes) {
            const result = matchFn(path);
            if (result) {
                queue.push({ result, callback });
            }
        }

        if (queue.length === 0) {
            socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            return;
        }

        return this.#wss.handleUpgrade(req, socket, head, async (ws, req) => {
            // `ws` never emits `connection` for a `handleUpgrade` handled
            // through a manual callback (that emit lives in the internal
            // listener `ws` only installs when it owns the server), so it
            // is surfaced here, once the handshake has completed, before
            // the handler chain runs.
            this.emit('connection', ws, req);

            for (const { result, callback } of queue) {
                const wsObj = ws as unknown as WebSocketObject<ParamData>;
                wsObj.params = result.params;
                wsObj.path = result.path;

                let next = false;
                const nextFn = () => { next = true };

                try {
                    await callback(wsObj, req, nextFn);
                } catch (err) {
                    this.#injected.console.error(err);
                    ws.close(1011, 'Handler threw an exception');
                    return;
                }

                if (!next) {
                    return;
                }
            }

            ws.close(1011, 'No handler claimed the connection');
        });
    };

    #injected: Required<SocketServerInject>;
    #routes: { callback: WebSocketCallback<ParamData>; matchFn: MatchFunction<ParamData>; }[] = [];
    #server: Server;
    #wss: WebSocketServer;

    /**
     * Builds the socket server around `options.server` without touching it:
     * construction has no side effects, so no upgrade handling is wired until
     * {@link bind} is called. Register routes with {@link use} and start
     * serving with {@link bind}.
     *
     * @param options - Configuration forwarded to the underlying `ws`
     * `WebSocketServer`, including the HTTP(S) `server` to attach to (see
     * {@link SocketServerOptions}).
     * @param inject - Optional dependency overrides, primarily used to
     * substitute the real WebSocket server implementation in tests.
     */
    constructor(options: SocketServerOptions, inject?: SocketServerInject) {
        super();
        this.#injected = {
            WebSocketServer:    inject?.WebSocketServer ?? WebSocketServer,
            console:            inject?.console         ?? globalThis.console
        };

        this.#server = options.server;
        this.#wss = new this.#injected.WebSocketServer({
            ...options,
            noServer: true,
            server: undefined,
            // Hard-forced (not just omitted from the type): `close()` iterates
            // `this.#wss.clients`, which `ws` only maintains while tracking is
            // on. A rogue `clientTracking: false` slipping through would leave
            // that set `undefined` and break teardown, so it is pinned here.
            clientTracking: true,
        }) as WebSocketServer;

        // `connection` is emitted manually from the `handleUpgrade` callback
        // below (see there); only the events `ws` actually fires during a
        // `noServer` handshake are forwarded here.
        this.#wss.on('headers',       (...a) => this.emit('headers',        ...a));
        this.#wss.on('wsClientError', (...a) => this.emit('wsClientError',  ...a));
    }

    /**
     * Shuts the socket layer down: detaches the upgrade handler (undoing
     * {@link bind}) and closes every live WebSocket connection.
     *
     * The underlying HTTP(S) server is deliberately left untouched — this
     * class does not own it, so stopping or restarting it is the caller's
     * responsibility. Nothing else is subscribed on the server, so this
     * leaves no lingering listeners; call {@link bind} again to resume
     * routing.
     *
     * @returns This same instance, to allow chaining.
     */
    close(): SocketServer {
        this.#server.off('upgrade', this.#upgradeCallback);
        for (const client of this.#wss.clients) client.close();
        return this;
    }

    /**
     * Attaches the upgrade handler to the server, so incoming upgrade requests
     * start being routed. Safe to call whether or not the server is already
     * listening, and idempotent: calling it repeatedly never stacks duplicate
     * handlers.
     *
     * To resume routing after a {@link close} + `Server.listen` restart, wire
     * this to the server's `listening` event yourself:
     *
     * ```ts
     * const app = new SocketServer({ server }).use(router).bind();
     * server.on('listening', () => app.bind());
     * ```
     *
     * @returns This same instance, to allow chaining.
     */
    bind(): SocketServer {
        this.#server.off('upgrade', this.#upgradeCallback);
        this.#server.on('upgrade', this.#upgradeCallback);
        return this;
    }

    /**
     * Registers a router's handlers on this server.
     *
     * Flattens `router` into its ordered `{ path, callback }` entries and
     * compiles a route matcher for each, appending them to the routes
     * consulted on every upgrade. Handlers keep their registration order, so
     * routes mounted by later calls are matched after earlier ones.
     *
     * @param router - The router whose routes are mounted onto this server.
     * @returns This same instance, to allow chaining.
     */
    use(router: SocketServerRouter): SocketServer {
        router
            .routes()
            .forEach(x => this.#routes.push({
                callback: x.callback,
                matchFn: createRouteMatcher(x.path)
            }));

        return this;
    }
}
