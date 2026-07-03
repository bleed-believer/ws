import type { ServerOptions } from 'ws';

/**
 * Configuration accepted by {@link SocketServer}.
 *
 * Based on `ws`'s `ServerOptions`, with the fields that {@link SocketServer}
 * manages internally removed: `noServer` (always `true`, since the server
 * is bootstrapped onto an existing HTTP server), `host`/`port` (the
 * underlying HTTP server owns the listening address) and `WebSocket`
 * (overridable only through dependency injection).
 */
export type SocketServerOptions = Omit<ServerOptions, 'noServer' | 'host' | 'port' | 'WebSocket'>;