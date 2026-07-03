import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { Duplex } from 'node:stream';

/**
 * Dependency-injection interface for {@link SocketServer}.
 *
 * Allows the real `ws` `WebSocketServer` constructor to be swapped for a
 * test double (see `SocketServerFake`) without changing the server's logic.
 */
export interface SocketServerInject {
    /**
     * Constructor for a `noServer`-mode WebSocket server, i.e. one that
     * only exposes `handleUpgrade` and does not listen on its own port.
     */
    WebSocketServer: new(o: { noServer: true }) => {
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
    };
}