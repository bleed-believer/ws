import type { WebSocketServerObject } from './web-socket-server.object.js';

/**
 * Dependency-injection interface for {@link SocketServer}.
 *
 * Allows the real `ws` `WebSocketServer` constructor to be swapped for a
 * test double (see `SocketServerFake`) without changing the server's logic.
 */
export interface SocketServerInject {
    /**
     * Constructor for a `noServer`-mode WebSocket server: one that does not
     * listen on its own port, exposing `handleUpgrade` to complete handshakes
     * and `clients` to enumerate live connections (see
     * {@link WebSocketServerObject}).
     */
    WebSocketServer: new(
        o: {
            noServer: true;
            server?: undefined;
        }
    ) => WebSocketServerObject;

    /**
     * Sink used to report handler failures, mirroring the subset of the
     * global `console` that {@link SocketServer} relies on. When omitted,
     * the server falls back to the global `console`. Inject a custom
     * implementation to redirect error logging (e.g. to a structured
     * logger) or to capture it in tests instead of writing to stderr.
     */
    console?: {
        /**
         * Logs the error thrown (or the promise rejection produced) by a
         * connection handler before the socket is closed with code `1011`.
         *
         * @param args - The error and any additional context to report.
         */
        error(...args: unknown[]): void;
    };
}