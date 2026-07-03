import type { IncomingMessage } from 'node:http';
import type { SocketServerInject } from './interfaces/index.js';
import type { ParamData } from 'path-to-regexp';
import type { WebSocket } from 'ws';
import type { Duplex } from 'node:stream';

/**
 * Record of a single `close()` call made on a {@link SocketFakeWebSocket}.
 */
export interface SocketFakeCloseCall {
    reason?: string;
    code?: number;
}

/**
 * Lightweight stand-in for a `ws` `WebSocket` instance, used by
 * {@link SocketServerFake} so tests can inspect route params, the matched
 * path and every `close()` call without opening a real socket.
 */
export interface SocketFakeWebSocket {
    closeCalls: SocketFakeCloseCall[];
    params?: ParamData;
    path?: string;

    close(code?: number, reason?: string): void;
}

/**
 * Snapshot of a single upgrade handled by {@link SocketServerFake}, exposing
 * the original request, the fake WebSocket it produced, and a promise that
 * resolves once the registered handler chain has finished running.
 */
export interface SocketFakeUpgrade {
    request: IncomingMessage;
    done: Promise<unknown>;
    ws: SocketFakeWebSocket;
}

/**
 * Test double for {@link SocketServerInject}.
 *
 * Replaces the real `ws` `WebSocketServer` with an in-memory implementation
 * that records every handled upgrade instead of performing a real WebSocket
 * handshake, allowing {@link SocketServer} to be exercised in unit tests
 * without a network connection.
 */
export class SocketServerFake implements SocketServerInject {
    #upgrades: SocketFakeUpgrade[] = [];
    /** Every upgrade handled so far, in the order they were received. */
    get upgrades(): SocketFakeUpgrade[] {
        return this.#upgrades;
    }

    readonly WebSocketServer: SocketServerInject['WebSocketServer'];

    #errors: unknown[] = [];
    /** Every argument passed to {@link console.error}, in call order. */
    get errors(): unknown[] {
        return this.#errors;
    }

    /**
     * Captures {@link SocketServer}'s error logging in memory instead of
     * writing to stderr, so tests can assert on it without mutating the
     * global `console`.
     */
    readonly console: SocketServerInject['console'];

    constructor() {
        const errors = this.#errors;
        this.console = {
            error(...args: unknown[]): void {
                errors.push(...args);
            }
        };

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
