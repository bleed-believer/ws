/**
 * Browser-safe entry point: everything reachable from here is built on the
 * standard `WebSocket` API, with no `ws` and no Node built-ins in its import
 * graph.
 *
 * This is the only entry point that exposes the client's `WebSocketObject` (the
 * minimal shape of a browser-style `WebSocket` it drives). The server's barrel
 * exports a different type under that same name; the package has no root barrel
 * that could re-export both, so the two can never collide.
 */
export type {
    WebSocketObject,
    SocketClientInject,
    SocketClientStatus,
    SocketClientOptions,
    SocketClientMessageType,
    SocketClientEventEmitter,
} from './socket-client/index.js';
export { SocketClient } from './socket-client/index.js';