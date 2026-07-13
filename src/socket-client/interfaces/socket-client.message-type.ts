import type { SocketClientOptions } from './socket-client.options.js';

export type SocketClientMessageType<T extends SocketClientOptions> =
    T['messageType'] extends 'arraybuffer'
?   ArrayBuffer
:   T['messageType'] extends 'blob'
?   Blob
:   string;
