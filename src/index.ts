/**
 * Public entry point of the `@bleed-believer/ws` package.
 *
 * Re-exports the router-based WebSocket server implementation along with
 * every public type declared under `./interfaces`.
 */

export { SocketServer } from './socket-server/index.js';
export { SocketServerRouter } from './socket-server-router/index.js';

export type {
    Server,
    WebSocketObject,
    WebSocketCallback,
    SocketServerOptions,
} from './socket-server/index.js';

export type { RouteParameters } from './socket-server-router/index.js';