import type { SocketClientOptions, SocketClientEventEmitter, SocketClientInject } from './interfaces/index.js';
import type { WebSocketObject, SocketClientStatus } from './interfaces/index.js';

import { EventEmitter } from '../event-emitter/index.js';

/**
 * WebSocket client driven by an explicit state machine:
 *
 * ```
 *                 ┌──────────────── open ─────────────────┐
 *                 │                                       ↓
 *  CLOSED ──connect()──→ CONNECTING            ┌──> CONNECTED ──close()──→ CLOSING
 *    ↑  ↑                     │                │         │                    │
 *    │  └─── error/abort ─────┘         open ──┘         │ unsolicited drop   │
 *    │                                    │              ↓                    │
 *    └────────────── close() ──────── RECONNECTING ←─────┘                    │
 *    ↑                                                                        │
 *    └────────────────────────────── close event ─────────────────────────────┘
 * ```
 *
 * Every path into `CLOSED` goes through {@link SocketClient.#shutdown}, which is
 * also where any pending `close()` is released — so the instance is always
 * reusable afterwards.
 */
export class SocketClient<T extends SocketClientOptions>
extends EventEmitter<SocketClientEventEmitter<T>> {
    #onMessageEvent = (e: MessageEvent) => {
        this.emit('socketMessage', e.data, e.origin);
    };

    #onErrorEvent = (e: Event) => {
        this.emit('socketError', this.#toError(e, `Unknown socket error`));
    };

    /**
     * Reaching this handler always means the peer dropped us: `close()` detaches it
     * from the socket before closing it, so a deliberate close never lands here.
     */
    #onCloseEvent = (e: CloseEvent) => {
        this.#detach();
        if (typeof this.#options?.reconnectMs === 'number') {
            this.#status = 'RECONNECTING';
            void this.#reconnect(e);
        } else {
            this.#shutdown(e);
        }
    };

    #controller?: AbortController;
    #injected: Required<SocketClientInject>;
    #wsClient?: WebSocketObject;
    /** Resolved by {@link SocketClient.#shutdown}, awaited by every pending `close()`. */
    #options?: T;
    #settled?: { promise: Promise<void>; resolve: () => void };
    #status: SocketClientStatus = 'CLOSED';
    #url: string | URL;

    constructor(url: string | URL, options?: T, inject?: SocketClientInject) {
        super();
        this.#injected = {
            WebSocket:  inject?.WebSocket   ?? globalThis.WebSocket
        };

        const { reconnectMs, timeoutMs } = options ?? {};
        if (
            typeof reconnectMs === 'number' &&
            (!Number.isInteger(reconnectMs) || reconnectMs < 0)
        ) {
            throw new RangeError(`The "reconnectMs" option must be an integer greater than or equal to 0`);
        } else if (
            typeof timeoutMs === 'number' &&
            (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
        ) {
            throw new RangeError(`The "timeoutMs" option must be an integer greater than 0`);
        }

        this.#options = options;
        this.#url = url;
    }

    #toError(e: Event, message: string): Error {
        const { error } = e as ErrorEvent;
        return  error instanceof Error
            ?   error
            :   new Error(message);
    }

    #attach(webSocket: WebSocketObject): void {
        this.#wsClient = webSocket;
        webSocket.addEventListener('message', this.#onMessageEvent);
        webSocket.addEventListener('error', this.#onErrorEvent);
        webSocket.addEventListener('close', this.#onCloseEvent);
    }

    #detach(): void {
        this.#wsClient?.removeEventListener('message', this.#onMessageEvent);
        this.#wsClient?.removeEventListener('error', this.#onErrorEvent);
        this.#wsClient?.removeEventListener('close', this.#onCloseEvent);
        this.#wsClient = undefined;
    }

    /**
     * The only transition into `CLOSED`. Takes the {@link CloseEvent} when the
     * connection had actually been established, so `socketClose` is emitted exactly
     * once; omit it when the handshake never succeeded, since there the caller of
     * `connect()` gets a rejection instead.
     */
    #shutdown(e?: CloseEvent): void {
        this.#detach();
        this.#status = 'CLOSED';

        const settled = this.#settled;
        this.#settled = undefined;
        this.#controller = undefined;

        if (e) {
            this.emit('socketClose', e.code, e.reason, e.wasClean);
        }

        settled?.resolve();
    }

    /** Wakes up on the timer or on `close()`, whichever comes first. */
    #sleep(ms: number, signal: AbortSignal): Promise<void> {
        return new Promise<void>(resolve => {
            const wake = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', wake);
                resolve();
            };

            const timer = setTimeout(wake, ms);
            signal.addEventListener('abort', wake);
        });
    }

    /** A single handshake. Only touches the state machine when it succeeds. */
    #attempt(signal: AbortSignal): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (signal.aborted) {
                reject(new Error(`The socket connection was aborted`));
                return;
            }

            const webSocket = new this.#injected.WebSocket(this.#url, this.#options?.protocols);
            switch (this.#options?.messageType) {
                case 'blob':
                case 'arraybuffer': {
                    webSocket.binaryType = this.#options.messageType;
                }
            }

            const dispose = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', onAbort);
                webSocket.removeEventListener('error', onError);
                webSocket.removeEventListener('close', onClose);
                webSocket.removeEventListener('open', onOpen);
            };

            const fail = (error: Error) => {
                dispose();
                webSocket.close();
                reject(error);
            };

            const onAbort = () => {
                fail(new Error(`The socket connection was aborted`));
            };

            const onError = (e: Event) => {
                fail(this.#toError(e, `Cannot establish a socket connection`));
            };

            const onClose = () => {
                fail(new Error(`The socket connection closed during the handshake`));
            };

            const onOpen = () => {
                dispose();
                this.#attach(webSocket);
                this.#status = 'CONNECTED';
                this.emit('socketOpen');
                resolve();
            };

            const timer = typeof this.#options?.timeoutMs === 'number'
                ?   setTimeout(
                        () => fail(new Error(`The socket connection timed out`)),
                        this.#options.timeoutMs
                    )
                :   undefined;

            signal.addEventListener('abort', onAbort);
            webSocket.addEventListener('error', onError);
            webSocket.addEventListener('close', onClose);
            webSocket.addEventListener('open', onOpen);
        });
    }

    /**
     * Retries until the peer takes us back or `close()` aborts the signal. `e` is the
     * drop that started the reconnection, and it's only reported as `socketClose` if
     * we end up giving up: from the consumer's point of view a successful retry means
     * the connection was never lost.
     */
    async #reconnect(e: CloseEvent): Promise<void> {
        const signal = this.#controller?.signal;
        const ms = this.#options?.reconnectMs;
        if (!signal || typeof ms !== 'number') {
            this.#shutdown(e);
            return;
        }

        while (!signal.aborted) {
            try {
                await this.#attempt(signal);
                return;
            } catch (err) {
                if (signal.aborted) { break; }
                this.emit('socketError', err instanceof Error
                    ?   err
                    :   new Error(`Unknown error`)
                );

                await this.#sleep(ms, signal);
            }
        }

        this.#shutdown(e);
    }

    get status(): SocketClientStatus {
        return this.#status;
    }

    get listening(): boolean {
        return this.#status === 'CONNECTED';
    }

    async connect(): Promise<void> {
        if (this.#status !== 'CLOSED') {
            throw new Error(`Cannot create a new connection when the current one is in "${this.#status}" status`);
        }

        let resolve!: () => void;
        const promise = new Promise<void>(r => { resolve = r; });
        const controller = new AbortController();

        this.#settled = { promise, resolve };
        this.#controller = controller;
        this.#status = 'CONNECTING';

        try {
            await this.#attempt(controller.signal);
        } catch (err) {
            this.#shutdown();
            throw err;
        }
    }

    async close(): Promise<void> {
        if (this.#status === 'CLOSED') {
            throw new Error(`The current socket connection is already closed`);
        }

        const settled = this.#settled?.promise;
        switch (this.#status) {
            case 'CONNECTING':
            case 'RECONNECTING': {
                // Unblocks the in-flight handshake and the reconnection backoff. Whoever
                // owns the signal is the one that drives the machine into CLOSED.
                this.#controller?.abort();
                break;
            }

            case 'CONNECTED': {
                const webSocket = this.#wsClient;
                this.#status = 'CLOSING';
                this.#controller?.abort();
                this.#detach();

                const onClose = (e: CloseEvent) => {
                    webSocket?.removeEventListener('close', onClose);
                    this.#shutdown(e);
                };

                webSocket?.addEventListener('close', onClose);
                webSocket?.close();
                break;
            }
        }

        await settled;
    }

    /**
     * Writes a frame to the peer. Only legal while `CONNECTED`: any other status means
     * there's no socket that could carry the frame, and silently dropping it would be
     * worse than saying so. In particular, a `RECONNECTING` client rejects the write
     * instead of buffering it — nothing here queues data across connections.
     */
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (this.#status !== 'CONNECTED') {
            throw new Error(`Cannot send data when the connection is in "${this.#status}" status`);
        }

        this.#wsClient?.send(data);
    }
}
