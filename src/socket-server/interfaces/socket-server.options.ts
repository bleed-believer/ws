import type { ServerOptions } from 'ws';
import type { Server } from './server.js';

/**
 * Configuration accepted by {@link SocketServer}.
 *
 * Based on `ws`'s `ServerOptions`, extended with the HTTP(S) `server` to
 * attach to and with the fields that {@link SocketServer} manages internally
 * removed: `noServer` (always `true`, since it runs in `noServer` mode),
 * `server` (replaced by the {@link Server} required here, so `ws` never owns
 * the upgrade handling) and `host`/`port` (the underlying HTTP server owns
 * the listening address).
 */
export interface SocketServerOptions extends Omit<
    ServerOptions,
    'noServer' | 'server' | 'host' | 'port'
> {
    /**
     * The HTTP(S) server whose `upgrade` event the socket server attaches to
     * when constructed.
     */
    server: Server;
};