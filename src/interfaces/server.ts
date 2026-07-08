import type { IncomingMessage } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';

/**
 * Minimal shape an HTTP(S) server must expose for a {@link SocketServer} to
 * attach to it: an `EventEmitter` that fires `upgrade` when a client requests
 * a protocol upgrade and `close` when the server shuts down, plus the
 * `listening` flag and `close()` method {@link SocketServer.close} uses to
 * tear the server down. Node's `http.Server`/`https.Server` satisfy it.
 */
export interface Server extends EventEmitter<{
    upgrade: [
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer
    ];

    close: [ ];
}> {
    /** Whether the server is currently accepting connections. */
    get listening(): boolean;

    /** Stops the server from accepting further connections. */
    close(): Server;
};