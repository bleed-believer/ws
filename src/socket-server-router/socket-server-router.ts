import type { ParamData } from 'path-to-regexp';

import type { WebSocketCallback } from '../socket-server/interfaces/index.js';
import type { RouteParameters } from './interfaces/index.js';

/**
 * Composable route registry for WebSocket connections.
 *
 * Handlers and sub-routers are registered with {@link use} and later
 * flattened into a single ordered list of `{ path, callback }` entries via
 * {@link routes}, which {@link SocketServer} consults to match incoming
 * upgrade requests. Routers can be nested to build path prefixes.
 */
export class SocketServerRouter {
    #routes: {
        path?: string;
        target: WebSocketCallback<ParamData> | SocketServerRouter;
    }[] = [];

    /**
     * Flattens this router's registrations, recursively expanding nested
     * sub-routers, into a single ordered list of routes. Path prefixes are
     * concatenated as sub-routers are unwrapped; pathless entries stay
     * `undefined` (matching any path) unless nested under a prefixed one.
     */
    routes(): {
        path?: string;
        callback: WebSocketCallback<ParamData>;
    }[] {
        const out: {
            path?: string;
            callback: WebSocketCallback<ParamData>;
        }[] = [];

        for (const { path, target } of this.#routes) {
            if (typeof target === 'function') {
                out.push({
                    path,
                    callback: target
                });
            } else {
                target
                    .routes()
                    .map(x => ({
                        callback: x.callback,
                        path: typeof path === 'string' || typeof x.path === 'string'
                        ?   ((path ?? '') + (x.path ?? '')).replace(/\/{2,}/g, '/')
                        :   undefined
                    }))
                    .forEach(x => out.push(x));
            }
        }

        return out;
    }

    /**
     * Mounts a sub-router that applies to every path (no prefix).
     */
    use(router: SocketServerRouter): SocketServerRouter;
    /**
     * Registers a handler that applies to every path (no filtering).
     */
    use(callback: WebSocketCallback<ParamData>): SocketServerRouter;
    /**
     * Mounts a sub-router under the given path prefix.
     */
    use(path: string, router: SocketServerRouter): SocketServerRouter;
    /**
     * Registers a handler for connections matching the given route
     * pattern.
     *
     * @typeParam P - Route pattern string.
     * @typeParam T - Parameters inferred from `P` via {@link RouteParameters}.
     */
    use<P extends string, T extends RouteParameters<P>>(path: P, callback: WebSocketCallback<T>): SocketServerRouter;
    use(
        ...args:
            [ SocketServerRouter | WebSocketCallback<ParamData> ] |
            [ string, SocketServerRouter | WebSocketCallback<ParamData> ]
    ): SocketServerRouter {
        const path = typeof args[0] === 'string'
        ?   args[0].startsWith('/') ? args[0] : '/' + args[0]
        :   undefined;

        const target = typeof args[0] === 'string'
        ?   args[1]!
        :   args[0];

        this.#routes.push({ path, target });
        return this;
    }
}