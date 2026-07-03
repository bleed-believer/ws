/**
 * Public entry point of the `@bleed-believer/ws` package.
 *
 * Re-exports the router-based WebSocket server implementation along with
 * every public type declared under `./interfaces`.
 */

export { SocketServer } from './socket-server.js';
export { SocketServerRouter } from './socket-server-router.js';

export * from './interfaces/index.js';