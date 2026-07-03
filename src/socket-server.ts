import type { RouteParameters, Server, SocketInject, WebSocketCallback, WebSocketObject, SocketServerOptions } from './interfaces/index.js';
import type { ParamData, MatchFunction, MatchResult } from 'path-to-regexp';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer } from 'ws';
import { SocketServerRouter } from './socket-server-router.js';
import { match } from 'path-to-regexp';

export class SocketServer extends SocketServerRouter {
    #injected: Required<SocketInject>;
    #options?: SocketServerOptions;

    constructor(options?: SocketServerOptions, inject?: SocketInject) {
        super();
        this.#options = options;
        this.#injected = {
            WebSocketServer: inject?.WebSocketServer?.bind(inject)  ?? WebSocketServer
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
                        console.error(err);
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