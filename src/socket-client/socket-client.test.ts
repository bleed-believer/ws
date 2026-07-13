import type { SocketClientOptions } from './interfaces/index.js';
import type { AddressInfo } from 'node:net';

import { deepStrictEqual, strictEqual, rejects, throws, ok } from 'node:assert';
import { describe, it } from 'node:test';
import { createServer } from 'node:http';
import { setTimeout } from 'node:timers/promises';

import { SocketServerRouter } from '../socket-server-router/index.js';
import { SocketClientFake } from './socket-client.fake.js';
import { SocketServer } from '../socket-server/index.js';
import { SocketClient } from './socket-client.js';

/**
 * Wires a {@link SocketClient} to a {@link SocketClientFake} and tallies every
 * event it emits, so each test can assert both the resulting state and how many
 * times the consumer was notified.
 */
function build<T extends SocketClientOptions>(options?: T) {
    const fake = new SocketClientFake();
    const client = new SocketClient('ws://fake', options, fake);
    const events = {
        messages: [] as unknown[],
        errors: [] as Error[],
        closes: 0,
        opens: 0
    };

    client.on('socketMessage', data => { events.messages.push(data); });
    client.on('socketError', error => { events.errors.push(error); });
    client.on('socketClose', () => { events.closes++; });
    client.on('socketOpen', () => { events.opens++; });

    return { client, events, fake };
}

describe('SocketClient', () => {
    describe('connect()', () => {
        it('opens the connection and emits socketOpen once', async () => {
            const { client, events, fake } = build();

            const connecting = client.connect();
            strictEqual(client.status, 'CONNECTING');

            fake.last.open();
            await connecting;

            strictEqual(client.status, 'CONNECTED');
            strictEqual(client.listening, true);
            strictEqual(events.opens, 1);
        });

        it('returns to CLOSED when the handshake fails, and can be retried', async () => {
            const { client, fake } = build();

            const connecting = client.connect();
            fake.last.fail(new Error(`ECONNREFUSED`));
            await rejects(connecting, /ECONNREFUSED/);

            strictEqual(client.status, 'CLOSED');
            strictEqual(fake.last.listenerCount(), 0);

            const retrying = client.connect();
            fake.last.open();
            await retrying;

            strictEqual(client.status, 'CONNECTED');
            strictEqual(fake.sockets.length, 2);
        });

        it('rejects instead of throwing synchronously when already busy', async () => {
            const { client, fake } = build();

            const connecting = client.connect();
            await rejects(client.connect(), /"CONNECTING" status/);

            fake.last.open();
            await connecting;
        });

        it('times out a handshake the peer never completes', async () => {
            const { client, fake } = build({ timeoutMs: 20 });

            await rejects(client.connect(), /timed out/);
            strictEqual(client.status, 'CLOSED');
            strictEqual(fake.last.closeCalls, 1);
        });
    });

    describe('close()', () => {
        it('closes cleanly, emits socketClose once and leaves the client reusable', async () => {
            const { client, events, fake } = build();

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            const socket = fake.last;
            const closing = client.close();
            strictEqual(client.status, 'CLOSING');

            socket.drop(1000, 'bye', true);
            await closing;

            strictEqual(client.status, 'CLOSED');
            strictEqual(events.closes, 1);
            strictEqual(socket.closeCalls, 1);
            strictEqual(socket.listenerCount(), 0);

            const reconnecting = client.connect();
            fake.last.open();
            await reconnecting;
            strictEqual(client.status, 'CONNECTED');
        });

        it('aborts an in-flight connect()', async () => {
            const { client, fake } = build();

            const connecting = client.connect();
            const closing = client.close();

            await rejects(connecting, /aborted/);
            await closing;

            strictEqual(client.status, 'CLOSED');
            strictEqual(fake.last.closeCalls, 1);
        });

        it('joins concurrent calls instead of closing twice', async () => {
            const { client, events, fake } = build();

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            const socket = fake.last;
            const first = client.close();
            const second = client.close();
            socket.drop();
            await Promise.all([ first, second ]);

            strictEqual(events.closes, 1);
            strictEqual(socket.closeCalls, 1);
        });

        it('rejects when there is nothing to close', async () => {
            const { client } = build();
            await rejects(client.close(), /already closed/);
        });
    });

    describe('unsolicited drops', () => {
        it('reports socketClose and returns to CLOSED when reconnection is off', async () => {
            const { client, events, fake } = build();

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            fake.last.drop(1006, 'gone', false);

            strictEqual(client.status, 'CLOSED');
            strictEqual(client.listening, false);
            strictEqual(events.closes, 1);

            const reconnecting = client.connect();
            fake.last.open();
            await reconnecting;

            strictEqual(client.status, 'CONNECTED');
            strictEqual(fake.sockets.length, 2);
        });

        it('reconnects without reporting socketClose when reconnection is on', async () => {
            const { client, events, fake } = build({ reconnectMs: 10 });

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            fake.last.drop(1006, '', false);
            strictEqual(client.status, 'RECONNECTING');
            strictEqual(fake.sockets.length, 2);

            fake.last.open();
            await setTimeout(20);

            strictEqual(client.status, 'CONNECTED');
            strictEqual(events.opens, 2);
            strictEqual(events.closes, 0);
        });

        it('keeps retrying while the peer stays down', async () => {
            const { client, events, fake } = build({ reconnectMs: 10 });

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            fake.last.drop(1006, '', false);
            fake.last.fail(new Error(`refused`));
            await setTimeout(40);

            ok(fake.sockets.length >= 3, `expected further attempts, got ${fake.sockets.length}`);
            strictEqual(client.status, 'RECONNECTING');
            ok(events.errors.length >= 1);

            await client.close();
        });
    });

    describe('reconnection cancelling', () => {
        it('close() aborts an in-flight reconnection attempt', async () => {
            const { client, events, fake } = build({ reconnectMs: 10 });

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            fake.last.drop(1006, 'dropped', false);
            strictEqual(client.status, 'RECONNECTING');
            strictEqual(fake.sockets.length, 2);

            await client.close();

            strictEqual(client.status, 'CLOSED');
            strictEqual(events.closes, 1);

            await setTimeout(40);
            strictEqual(fake.sockets.length, 2);
        });

        it('close() wakes up the backoff instead of waiting it out', async () => {
            const { client, events, fake } = build({ reconnectMs: 5_000 });

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            fake.last.drop(1006, '', false);
            fake.last.fail(new Error(`refused`));
            await setTimeout(10);

            strictEqual(client.status, 'RECONNECTING');
            strictEqual(fake.sockets.length, 2);

            const started = Date.now();
            await client.close();
            const elapsed = Date.now() - started;

            ok(elapsed < 1_000, `close() waited ${elapsed}ms for the backoff`);
            strictEqual(client.status, 'CLOSED');
            strictEqual(events.closes, 1);

            await setTimeout(40);
            strictEqual(fake.sockets.length, 2);
        });
    });

    describe('send()', () => {
        it('writes the frame to the socket while connected', async () => {
            const { client, fake } = build();

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            client.send('ping');
            client.send('pong');

            deepStrictEqual(fake.last.sent, [ 'ping', 'pong' ]);
        });

        it('refuses to write when there is no connection', () => {
            const { client } = build();
            throws(() => client.send('ping'), /"CLOSED" status/);
        });

        it('refuses to write while reconnecting, instead of dropping the frame', async () => {
            const { client, fake } = build({ reconnectMs: 10 });

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            fake.last.drop(1006, '', false);
            strictEqual(client.status, 'RECONNECTING');
            throws(() => client.send('ping'), /"RECONNECTING" status/);

            await client.close();
        });

        it('writes again through the new socket after a reconnection', async () => {
            const { client, fake } = build({ reconnectMs: 10 });

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            const first = fake.last;
            client.send('before');

            first.drop(1006, '', false);
            fake.last.open();
            await setTimeout(20);

            strictEqual(client.status, 'CONNECTED');
            client.send('after');

            deepStrictEqual(first.sent, [ 'before' ]);
            deepStrictEqual(fake.last.sent, [ 'after' ]);
        });
    });

    describe('options', () => {
        it('refuses a reconnectMs that would turn the loop into a hot spin', () => {
            throws(() => new SocketClient('ws://fake', { reconnectMs: NaN }, new SocketClientFake()), RangeError);
            throws(() => new SocketClient('ws://fake', { reconnectMs: -1 }, new SocketClientFake()), RangeError);
            throws(() => new SocketClient('ws://fake', { reconnectMs: 1.5 }, new SocketClientFake()), RangeError);
        });

        it('refuses a non-positive timeoutMs', () => {
            throws(() => new SocketClient('ws://fake', { timeoutMs: 0 }, new SocketClientFake()), RangeError);
            throws(() => new SocketClient('ws://fake', { timeoutMs: NaN }, new SocketClientFake()), RangeError);
        });

        it('forwards protocols and binaryType to the socket', async () => {
            const { client, fake } = build({ messageType: 'arraybuffer', protocols: [ 'json' ] });

            const connecting = client.connect();
            fake.last.open();
            await connecting;

            strictEqual(fake.last.binaryType, 'arraybuffer');
            strictEqual(fake.last.protocols?.[0], 'json');
        });
    });

    it('delivers inbound messages', async () => {
        const { client, events, fake } = build();

        const connecting = client.connect();
        fake.last.open();
        await connecting;

        fake.last.message('hello');
        fake.last.message('world');

        strictEqual(events.messages.length, 2);
        strictEqual(events.messages[0], 'hello');
    });

    it('e2e example', async (t: it.TestContext) => {
        const httpServer = createServer();
        const wsServer = new SocketServer({ server: httpServer }).use(
            new SocketServerRouter().use(ws => {
                let i = 0;
                const clock = setInterval(
                    () => {
                        ws.send(`index: ${i++}`);
                        if (i > 4) ws.close();
                    },
                    50
                );

                ws.once('close', () => clearInterval(clock));
            })
        );

        wsServer.bind();
        httpServer.listen();

        const { port } = httpServer.address() as AddressInfo;
        const messages: string[] = [];
        const wsClient = new SocketClient(
            `ws://localhost:${port}`,
            { reconnectMs: 1000 }
        );

        wsClient.on('socketMessage', async m => {
            messages.push(m);
            if (messages.length >= 10) {
                return wsClient.close();
            }
        });

        await wsClient.connect();
        await new Promise<void>((resolve, reject) => {
            wsClient.once('socketClose', () => resolve());
            wsClient.once('socketError', er => reject(er));
        });

        wsServer.close();
        httpServer.close();
        t.assert.deepStrictEqual(messages, [
            `index: 0`,
            `index: 1`,
            `index: 2`,
            `index: 3`,
            `index: 4`,
            `index: 0`,
            `index: 1`,
            `index: 2`,
            `index: 3`,
            `index: 4`,
        ]);
    });
});
