import type { RouteParameters, Server, SocketServerInject, WebSocketCallback, WebSocketObject, SocketServerOptions } from './interfaces/index.js';
import type { ParamData, MatchResult } from 'path-to-regexp';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { SocketServerRouter } from './socket-server-router.js';
import { createRouteMatcher } from './route-matcher.js';
import { WebSocketServer } from 'ws';

/**
 * Router-based WebSocket server that attaches to an existing HTTP(S)
 * server and dispatches upgrade requests to the handlers registered
 * through {@link SocketServerRouter.use}, matching each connection's URL
 * against `path-to-regexp` route patterns.
 */
export class SocketServer extends SocketServerRouter {
    #injected: Required<SocketServerInject>;
    #options?: SocketServerOptions;

    /**
     * @param options - Options forwarded to the underlying `ws`
     * `WebSocketServer` (see {@link SocketServerOptions}).
     * @param inject - Optional dependency overrides, primarily used to
     * substitute the real WebSocket server implementation in tests.
     */
    constructor(options?: SocketServerOptions, inject?: SocketServerInject) {
        super();
        this.#options = options;
        this.#injected = {
            WebSocketServer:    inject?.WebSocketServer?.bind(inject)   ?? WebSocketServer,
            console:            inject?.console                         ?? globalThis.console
        };
    }

    override use(router: SocketServerRouter): SocketServer;
    override use(callback: WebSocketCallback<ParamData>): SocketServer;
    override use(path: string, router: SocketServerRouter): SocketServer;
    override use<P extends string, T extends RouteParameters<P>>(path: P, callback: WebSocketCallback<T>): SocketServer;
    override use(...args: [SocketServerRouter | WebSocketCallback<ParamData>] | [string, SocketServerRouter | WebSocketCallback<ParamData>]): SocketServer {
        super.use(args[0] as any, args[1] as any);
        return this;
    }

    /**
     * Attaches this server to the given HTTP(S) server's `upgrade` event.
     *
     * For each upgrade request, resolves the registered routes matching
     * the request's URL, completes the WebSocket handshake, and invokes
     * the matching handlers in registration order until one of them
     * claims the connection (i.e. does not call `next()`). If no handler
     * claims the connection, it is closed with code `1011`; if no route
     * matches at all, the raw socket is rejected with an HTTP 404 response
     * before the handshake occurs. The listener is automatically detached
     * when the server emits `close`.
     *
     * @param server - The HTTP(S) server to bootstrap the WebSocket
     * upgrade handling onto.
     * @returns The `ws` {@link WebSocketServer} instance created to handle
     * the upgrades.
     */
    bootstrap(server: Server): WebSocketServer {
        const routes = this
            .routes()
            .map(x => ({
                callback: x.callback,
                matchFn: createRouteMatcher(x.path)
            }));

        const wss = new this.#injected.WebSocketServer({
            ...this.#options,
            noServer: true
        });

        const fnc = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
            // Extract the path exactly as Express 5's `parseurl` does: strip
            // the query string and nothing else. The WHATWG `URL` parser is
            // deliberately avoided here because it normalizes dot-segments
            // (`/a/../b` → `/b`) and resolves protocol-relative/absolute
            // request-targets (`//host/bar` → `/bar`), which would let a
            // request reach a route it does not literally match and diverge
            // from Express's route parsing.
            const raw = req.url ?? '/';
            const query = raw.indexOf('?');
            const path = query === -1 ? raw : raw.slice(0, query);
            const queue: {
                result: MatchResult<ParamData>;
                callback: WebSocketCallback<ParamData>;
            }[] = [];

            for (const { matchFn, callback } of routes) {
                const result = matchFn(path);
                if (result) {
                    queue.push({ result, callback });
                }
            }

            if (queue.length === 0) {
                socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
                return;
            }

            return wss.handleUpgrade(req, socket, head, async (ws, req) => {
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

        server.on('upgrade', fnc);
        server.once('close', () => {
            server.off('upgrade', fnc);
        });

        return wss as WebSocketServer;
    }
}