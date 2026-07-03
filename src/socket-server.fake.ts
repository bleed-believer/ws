import type { IncomingMessage } from 'node:http';
import type { SocketInject } from './interfaces/index.js';
import type { ParamData } from 'path-to-regexp';
import type { WebSocket } from 'ws';
import type { Duplex } from 'node:stream';

export interface SocketFakeCloseCall {
    reason?: string;
    code?: number;
}

export interface SocketFakeWebSocket {
    closeCalls: SocketFakeCloseCall[];
    params?: ParamData;
    path?: string;

    close(code?: number, reason?: string): void;
}

export interface SocketFakeUpgrade {
    request: IncomingMessage;
    done: Promise<unknown>;
    ws: SocketFakeWebSocket;
}

export class SocketServerFake implements SocketInject {
    #upgrades: SocketFakeUpgrade[] = [];
    get upgrades(): SocketFakeUpgrade[] {
        return this.#upgrades;
    }

    readonly WebSocketServer: SocketInject['WebSocketServer'];

    constructor() {
        const upgrades = this.#upgrades;
        this.WebSocketServer = class {
            constructor(_options: { noServer: true }) {}

            handleUpgrade(
                request: IncomingMessage,
                _socket: Duplex,
                _head: Buffer,
                callback: (ws: WebSocket, request: IncomingMessage) => unknown
            ): void {
                const closeCalls: SocketFakeCloseCall[] = [];
                const ws: SocketFakeWebSocket = {
                    closeCalls,
                    close(code?: number, reason?: string): void {
                        closeCalls.push({ code, reason });
                    }
                };

                const done = Promise.resolve(
                    callback(ws as unknown as WebSocket, request)
                );

                upgrades.push({ request, done, ws });
            }
        };
    }
}
