import type { SocketClientMessageType } from './socket-client.message-type.js';
import type { SocketClientOptions } from './socket-client.options.js';

export interface SocketClientEventEmitter<T extends SocketClientOptions> {
    socketMessage:  [ data: SocketClientMessageType<T>, origin: string ];
    socketClose:    [ code: number, reason: string, wasClean: boolean ];
    socketError:    [ error: Error ];
    socketOpen:     [ ];
}