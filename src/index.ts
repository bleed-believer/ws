/**
 * Public entry point of the `@bleed-believer/ws` package.
 *
 * Re-exports the router-based WebSocket server and the reconnecting WebSocket
 * client, along with every public type declared under their `./interfaces`.
 */

export { SocketServer } from './socket-server/index.js';
export { SocketServerRouter } from './socket-server-router/index.js';
export { SocketClient } from './socket-client/index.js';

export type {
    Server,
    WebSocketObject,
    WebSocketCallback,
    SocketServerOptions,
} from './socket-server/index.js';

export type { RouteParameters } from './socket-server-router/index.js';

/**
 * `WebSocketObject` is deliberately left out: the client declares its own
 * (the minimal shape of a browser-style `WebSocket` it drives), and the name is
 * already taken by the server's decorated socket. Import it from
 * `@bleed-believer/ws` only through the client's own barrel if you need it.
 */
export type {
    SocketClientInject,
    SocketClientStatus,
    SocketClientOptions,
    SocketClientMessageType,
    SocketClientEventEmitter,
} from './socket-client/index.js';
