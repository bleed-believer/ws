import type { RouteParameters, Server, SocketServerInject, WebSocketCallback, WebSocketObject, SocketServerOptions } from './interfaces/index.js';
import type { ParamData, MatchFunction, MatchResult } from 'path-to-regexp';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer } from 'ws';
import { SocketServerRouter } from './socket-server-router.js';
import { match } from 'path-to-regexp';

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
     */
    bootstrap(server: Server): void {
        const routes = this
            .routes()
            .map(x => ({
                callback: x.callback,
                matchFn: typeof x.path !== 'string'
                ?   ((path: string) => ({ path, params: {} })) as MatchFunction<ParamData>
                :   match(x.path)
            }));

        const wss = new this.#injected.WebSocketServer({
            ...this.#options,
            noServer: true
        });

        const fnc = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
            const path = new URL(req.url ?? '/', 'http://localhost').pathname;
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
                socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                socket.destroy();
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
    }
}