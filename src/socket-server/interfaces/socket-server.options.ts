import type { ServerOptions } from 'ws';
import type { Server } from './server.js';

/**
 * Configuration accepted by {@link SocketServer}.
 *
 * Based on `ws`'s `ServerOptions`, extended with the HTTP(S) `server` to
 * attach to and with the fields that {@link SocketServer} manages internally
 * removed: `noServer` (always `true`, since it runs in `noServer` mode),
 * `server` (replaced by the {@link Server} required here, so `ws` never owns
 * the upgrade handling), `host`/`port` (the underlying HTTP server owns the
 * listening address), `clientTracking` (always `true`, because
 * {@link SocketServer.close} relies on the `clients` set to drop every live
 * connection; disabling it would leave `close()` unable to enumerate them) and
 * `path` (this layer owns request-path routing through its registered routes;
 * `ws`'s own `path` filter would double-filter inside `handleUpgrade`, rejecting
 * an already-matched upgrade with a bare `400` and, being an exact-equality
 * check, ignoring params and wildcards).
 */
export interface SocketServerOptions extends Omit<
    ServerOptions,
    'noServer' | 'server' | 'host' | 'port' | 'clientTracking' | 'path'
> {
    /**
     * The HTTP(S) server whose `upgrade` event the socket server attaches to
     * when constructed.
     */
    server: Server;
};