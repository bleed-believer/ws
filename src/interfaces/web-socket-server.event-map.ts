import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { Duplex } from 'node:stream';

/**
 * Event map of a `ws` `WebSocketServer`, shared by every `EventEmitter`
 * that mirrors those events: the {@link WebSocketServerObject} contract, the
 * {@link SocketServer} that re-emits them, and the test double that stands in
 * for the real server. Keeping the map in one place stops the three from
 * drifting apart.
 */
export interface WebSocketServerEventMap {
    connection:     [ websocket: WebSocket, request: IncomingMessage ],
    error:          [ error: Error ],
    headers:        [ headers: string[], request: IncomingMessage ],
    close:          [ ],
    listening:      [ ],
    wsClientError:  [ error: Error, socket: Duplex, request: IncomingMessage ],
}