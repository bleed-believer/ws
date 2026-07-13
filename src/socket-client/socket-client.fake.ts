import type { SocketClientInject, WebSocketObject } from './interfaces/index.js';

/**
 * `never` as the parameter keeps the implementation signature compatible with
 * every `addEventListener` overload of {@link WebSocketObject}, whose callbacks
 * take unrelated event subtypes.
 */
type FakeListener = (e: never) => unknown;

/**
 * In-memory stand-in for a `WebSocket`. It never touches the network: the
 * handshake and every subsequent event are driven by the test through
 * {@link open}, {@link fail}, {@link message} and {@link drop}.
 */
export class SocketFakeWebSocket implements WebSocketObject {
    #listeners = new Map<string, Set<FakeListener>>();
    #readyState: globalThis.WebSocket['readyState'] = 0;
    get readyState(): globalThis.WebSocket['readyState'] {
        return this.#readyState;
    }

    #closeCalls = 0;
    /** How many times {@link SocketClient} asked this socket to close. */
    get closeCalls(): number {
        return this.#closeCalls;
    }

    #sent: unknown[] = [];
    /** Every frame written through {@link send}, in call order. */
    get sent(): unknown[] {
        return this.#sent;
    }

    readonly protocols?: string[];
    readonly url: string | URL;

    binaryType: globalThis.WebSocket['binaryType'] = 'blob';

    constructor(url: string | URL, protocols?: string[]) {
        this.protocols = protocols;
        this.url = url;
    }

    #dispatch(name: string, e: unknown): void {
        for (const listener of [ ...this.#listeners.get(name) ?? [] ]) {
            (listener as (e: unknown) => unknown)(e);
        }
    }

    addEventListener(name: 'message', c: (e: MessageEvent) => unknown): void;
    addEventListener(name: 'close', c: (e: CloseEvent) => unknown): void;
    addEventListener(name: 'error', c: (e: Event) => unknown): void;
    addEventListener(name: 'open', c: (e: Event) => unknown): void;
    addEventListener(name: string, c: FakeListener): void {
        const listeners = this.#listeners.get(name) ?? new Set();
        this.#listeners.set(name, listeners.add(c));
    }

    removeEventListener(name: 'message', c: (e: MessageEvent) => unknown): void;
    removeEventListener(name: 'close', c: (e: CloseEvent) => unknown): void;
    removeEventListener(name: 'error', c: (e: Event) => unknown): void;
    removeEventListener(name: 'open', c: (e: Event) => unknown): void;
    removeEventListener(name: string, c: FakeListener): void {
        this.#listeners.get(name)?.delete(c);
    }

    /** How many listeners are currently attached, to assert nothing leaks. */
    listenerCount(name?: string): number {
        const names = typeof name === 'string'
            ?   [ name ]
            :   [ ...this.#listeners.keys() ];

        return names.reduce((acc, key) => acc + (this.#listeners.get(key)?.size ?? 0), 0);
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        this.#sent.push(data);
    }

    close(): void {
        this.#closeCalls++;
        if (this.#readyState !== 3) {
            this.#readyState = 2;
        }
    }

    // --- Test drivers ------------------------------------------------------

    /** Completes the handshake successfully. */
    open(): void {
        this.#readyState = 1;
        this.#dispatch('open', { type: 'open' });
    }

    /** Fails the socket, like a refused connection or a transport error. */
    fail(error?: Error): void {
        this.#dispatch('error', { type: 'error', error });
    }

    /** Delivers an inbound frame. */
    message(data: unknown, origin = 'ws://fake'): void {
        this.#dispatch('message', { type: 'message', data, origin });
    }

    /** Emits the `close` event, as the peer (or the transport) would. */
    drop(code = 1000, reason = '', wasClean = true): void {
        this.#readyState = 3;
        this.#dispatch('close', { type: 'close', code, reason, wasClean });
    }
}

/**
 * Test double for {@link SocketClientInject}: hands {@link SocketClient} a
 * `WebSocket` constructor that yields {@link SocketFakeWebSocket} instances and
 * records every one of them, so a test can drive the handshake by hand and
 * assert how many sockets were actually opened (which is how reconnection and
 * its cancellation are observed).
 */
export class SocketClientFake implements SocketClientInject {
    #sockets: SocketFakeWebSocket[] = [];
    /** Every socket built so far, in creation order. */
    get sockets(): SocketFakeWebSocket[] {
        return this.#sockets;
    }

    /** The most recently built socket. */
    get last(): SocketFakeWebSocket {
        const socket = this.#sockets.at(-1);
        if (!socket) {
            throw new Error(`No socket has been created yet`);
        }

        return socket;
    }

    readonly WebSocket: SocketClientInject['WebSocket'];

    constructor() {
        const sockets = this.#sockets;
        this.WebSocket = class extends SocketFakeWebSocket {
            static readonly CONNECTING = 0;
            static readonly OPEN = 1;
            static readonly CLOSING = 2;
            static readonly CLOSED = 3;

            constructor(url: string | URL, protocols?: string[]) {
                super(url, protocols);
                sockets.push(this);
            }
        };
    }
}
