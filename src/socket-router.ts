import type { RouteParameters, WebSocketCallback } from './interfaces/index.js';
import type { ParamData } from 'path-to-regexp';

export class SocketRouter {
    #routes: {
        path?: string;
        target: WebSocketCallback<ParamData> | SocketRouter;
    }[] = [];

    use(router: SocketRouter): SocketRouter;
    use(callback: WebSocketCallback<ParamData>): SocketRouter;
    use(path: string, router: SocketRouter): SocketRouter;
    use<P extends string, T extends RouteParameters<P>>(path: P, callback: WebSocketCallback<T>): SocketRouter;
    use(
        ...args:
            [ SocketRouter | WebSocketCallback<ParamData> ] |
            [ string, SocketRouter | WebSocketCallback<ParamData> ]
    ): SocketRouter {
        const path = typeof args[0] === 'string'
        ?   args[0].startsWith('/') ? args[0] : '/' + args[0]
        :   undefined;

        const target = typeof args[0] === 'string'
        ?   args[1]!
        :   args[0];

        this.#routes.push({ path, target });
        return this;
    }

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
                        ?   (path ?? '') + (x.path ?? '')
                        :   undefined
                    }))
                    .forEach(x => out.push(x));
            }
        }

        return out;
    }
}