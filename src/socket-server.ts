import type { Server, SocketServerOptions, WebSocketCallback, WebSocketObject } from './interfaces/index.js';
import type { WebSocketServerObject, SocketServerInject, WebSocketServerEventMap } from './interfaces/index.js';
import type { MatchFunction, MatchResult, ParamData } from 'path-to-regexp';
import type { SocketServerRouter } from './socket-server-router.js';

import { createRouteMatcher } from './route-matcher.js';
import { WebSocketServer } from 'ws';
import EventEmitter from 'node:events';

/**
 * Router-based WebSocket server that attaches to an existing HTTP(S)
 * server's `upgrade` event and dispatches each upgrade request to the
 * handlers registered through {@link use}, matching the connection's URL
 * against `path-to-regexp` route patterns.
 *
 * The upgrade listener is wired in the constructor, so the target server is
 * supplied up front through {@link SocketServerOptions.server}; call
 * {@link close} to tear the server and its live connections down.
 */
export class SocketServer extends EventEmitter<WebSocketServerEventMap> {
    #routes: {
        callback: WebSocketCallback<ParamData>;
        matchFn: MatchFunction<ParamData>;
    }[] = [];

    #injected: Required<SocketServerInject>;
    #server: Server;
    #wss: WebSocketServer;

    /**
     * Attaches the WebSocket upgrade handling onto `options.server`.
     *
     * For each upgrade request, resolves the registered routes matching the
     * request's URL, completes the WebSocket handshake, and invokes the
     * matching handlers in registration order until one of them claims the
     * connection (i.e. does not call `next()`). If no handler claims the
     * connection, it is closed with code `1011`; if no route matches at all,
     * the raw socket is rejected with an HTTP 404 response before the
     * handshake occurs.
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
        }) as WebSocketServer;

        this.#wss.on('connection',    (...a) => this.emit('connection',     ...a));
        this.#wss.on('error',         (...a) => this.emit('error',          ...a));
        this.#wss.on('headers',       (...a) => this.emit('headers',        ...a));
        this.#wss.on('close',         (...a) => this.emit('close',          ...a));
        this.#wss.on('listening',     (...a) => this.emit('listening',      ...a));
        this.#wss.on('wsClientError', (...a) => this.emit('wsClientError',  ...a));

        this.#server.on('upgrade', (req, socket, head) => {
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
        });
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

    /**
     * Tears the server down: closes every live WebSocket connection and, if
     * the underlying HTTP(S) server is still listening, closes it too.
     *
     * @returns This same instance, to allow chaining.
     */
    close(): SocketServer {
        for (const client of this.#wss.clients) client.close();
        if (this.#server.listening) this.#server.close();
        return this;
    }
}