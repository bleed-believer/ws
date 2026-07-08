import type { IncomingMessage } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';

/**
 * Minimal shape an HTTP(S) server must expose for a {@link SocketServer} to
 * attach to it: an `EventEmitter` that fires `upgrade` when a client requests
 * a protocol upgrade. {@link SocketServer} only ever adds and removes an
 * `upgrade` listener; starting, stopping or restarting the server is the
 * caller's responsibility, so nothing else is required here. Node's
 * `http.Server`/`https.Server` satisfy it.
 */
export interface Server extends EventEmitter<{
    upgrade: [
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer
    ];
}> {};