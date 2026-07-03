import type { IncomingMessage } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';

export type Server = EventEmitter<{
    upgrade: [
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer
    ];

    close: [ ];
}>;