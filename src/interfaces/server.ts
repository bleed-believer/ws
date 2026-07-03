import type { IncomingMessage } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';

/**
 * Minimal shape an HTTP(S) server must expose so a {@link SocketServer} can
 * be bootstrapped on top of it: an `EventEmitter` that fires `upgrade` when
 * a client requests a protocol upgrade, and `close` when the server shuts
 * down.
 */
export type Server = EventEmitter<{
    upgrade: [
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer
    ];

    close: [ ];
}>;