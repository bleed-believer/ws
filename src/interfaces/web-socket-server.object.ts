import type { WebSocketServerEventMap } from './web-socket-server.event-map.js';
import type { IncomingMessage } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { Duplex } from 'node:stream';

/**
 * Minimal surface of a `ws` `WebSocketServer` (in `noServer` mode) that
 * {@link SocketServer} depends on: completing upgrade handshakes and
 * enumerating the live client connections it tracks.
 */
export interface WebSocketServerObject extends EventEmitter<WebSocketServerEventMap> {
    /**
     * Completes the WebSocket handshake for a raw HTTP upgrade request
     * and hands the resulting socket to `callback`.
     *
     * @param request - The incoming HTTP upgrade request.
     * @param socket - The underlying TCP/TLS socket.
     * @param head - The first packet of the upgraded stream.
     * @param callback - Invoked with the established WebSocket once the
     * handshake completes.
     */
    handleUpgrade(
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer,
        callback: (
            ws: WebSocket,
            request: IncomingMessage
        ) => unknown
    ): void;

    /**
     * The set of currently connected sockets the server tracks, used by
     * {@link SocketServer.close} to close each one on teardown.
     */
    clients: Set<{
        close(
            code?: number,
            data?: string | Buffer<ArrayBufferLike>
        ): void;
    }>;
}