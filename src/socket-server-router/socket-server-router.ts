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
     *
     * `end` marks how the resulting path is matched: `true` (the default) for
     * an exact route, `false` for a **prefix mount** — a pathless handler or
     * sub-router mounted under a prefix, which then matches that prefix and
     * everything below it, the way Express's `app.use('/api', mw)` does. The
     * flag propagates outward, so wrapping a prefix mount under a further
     * prefix keeps it a prefix mount.
     */
    routes(): {
        path?: string;
        end?: boolean;
        callback: WebSocketCallback<ParamData>;
    }[] {
        const out: {
            path?: string;
            end?: boolean;
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
                    .map(x => {
                        // A pathless child mounted under a prefix becomes a
                        // prefix mount; an already-prefix-mounted child stays
                        // one however deep it is re-nested.
                        const isPrefixMount = typeof path === 'string' && typeof x.path !== 'string';
                        return {
                            callback: x.callback,
                            end: (x.end ?? true) && !isPrefixMount,
                            path: typeof path === 'string' || typeof x.path === 'string'
                            ?   ((path ?? '') + (x.path ?? '')).replace(/\/{2,}/g, '/')
                            :   undefined
                        };
                    })
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