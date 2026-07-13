import type { WebSocketObject } from './web-socket.object.js';

export interface SocketClientInject {
    WebSocket?: {
        CONNECTING: (typeof globalThis.WebSocket)['CONNECTING'];
        CLOSING: (typeof globalThis.WebSocket)['CLOSING'];
        CLOSED: (typeof globalThis.WebSocket)['CLOSED'];
        OPEN: (typeof globalThis.WebSocket)['OPEN'];

        new(url: string | URL, protocols?: string[]): WebSocketObject;
    };
}