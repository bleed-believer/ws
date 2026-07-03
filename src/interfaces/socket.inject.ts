import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { Duplex } from 'node:stream';

export interface SocketInject {
    WebSocketServer: new(o: { noServer: true }) => {
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