import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { Duplex } from 'node:stream';

/**
 * Event map of a `ws` `WebSocketServer`, shared by every `EventEmitter`
 * that mirrors those events: the {@link WebSocketServerObject} contract, the
 * {@link SocketServer} that re-emits them, and the test double that stands in
 * for the real server. Keeping the map in one place stops the three from
 * drifting apart.
 *
 * Only the events {@link SocketServer} can actually surface while running in
 * `noServer` mode are listed. The lifecycle events a `ws` server emits when
 * it owns its own port — `listening`, `close` and the underlying-server
 * `error` — never fire here (the HTTP server is external and its upgrade
 * handling is driven manually), so they are deliberately left out rather
 * than advertised as dead events.
 */
export interface WebSocketServerEventMap {
    connection:     [ websocket: WebSocket, request: IncomingMessage ],
    headers:        [ headers: string[], request: IncomingMessage ],
    wsClientError:  [ error: Error, socket: Duplex, request: IncomingMessage ],
}