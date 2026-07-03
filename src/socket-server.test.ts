import type { IncomingMessage } from 'node:http';
import type { Server } from './interfaces/index.js';
import type { Duplex } from 'node:stream';

import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { SocketServerFake } from './socket-server.fake.js';
import { SocketServer } from './socket-server.js';

describe('SocketServer', () => {
    it('Attend a connection with a static path', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = new EventEmitter() as Server;
        const calls: string[] = [];

        new SocketServer({}, fake)
            .use('/foo', () => { calls.push('foo'); })
            .bootstrap(server);

        server.emit(
            'upgrade',
            { url: '/foo?token=bleed' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        t.assert.strictEqual(fake.upgrades.length, 1);
        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.deepStrictEqual(calls, [ 'foo' ]);
        t.assert.strictEqual(upgrade.ws.path, '/foo');
        t.assert.deepStrictEqual({ ...upgrade.ws.params }, {});
        t.assert.deepStrictEqual(upgrade.ws.closeCalls, []);
    });

    it('Extract the params from the path', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = new EventEmitter() as Server;

        new SocketServer({}, fake)
            .use('/user/:id/:action', () => {})
            .bootstrap(server);

        server.emit(
            'upgrade',
            { url: '/user/555/edit' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.strictEqual(upgrade.ws.path, '/user/555/edit');
        t.assert.deepStrictEqual({ ...upgrade.ws.params }, { id: '555', action: 'edit' });
        t.assert.deepStrictEqual(upgrade.ws.closeCalls, []);
    });

    it('Attend any path when the route is pathless', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = new EventEmitter() as Server;
        const calls: string[] = [];

        new SocketServer({}, fake)
            .use(() => { calls.push('any'); })
            .bootstrap(server);

        server.emit(
            'upgrade',
            { url: '/whatever/path' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.deepStrictEqual(calls, [ 'any' ]);
        t.assert.strictEqual(upgrade.ws.path, '/whatever/path');
        t.assert.deepStrictEqual({ ...upgrade.ws.params }, {});
    });

    it('Pass the control to the next handler with next()', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = new EventEmitter() as Server;
        const calls: string[] = [];

        new SocketServer({}, fake)
            .use('/foo', (_ws, _req, next) => {
                calls.push('fn-01');
                next();
            })
            .use('/foo', () => { calls.push('fn-02'); })
            .bootstrap(server);

        server.emit(
            'upgrade',
            { url: '/foo' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.deepStrictEqual(calls, [ 'fn-01', 'fn-02' ]);
        t.assert.deepStrictEqual(upgrade.ws.closeCalls, []);
    });

    it('Stop the chain when a handler does not call next()', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = new EventEmitter() as Server;
        const calls: string[] = [];

        new SocketServer({}, fake)
            .use('/foo', () => { calls.push('fn-01'); })
            .use('/foo', () => { calls.push('fn-02'); })
            .bootstrap(server);

        server.emit(
            'upgrade',
            { url: '/foo' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.deepStrictEqual(calls, [ 'fn-01' ]);
        t.assert.deepStrictEqual(upgrade.ws.closeCalls, []);
    });

    it('Close the connection when no handler claims it', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = new EventEmitter() as Server;

        new SocketServer({}, fake)
            .use('/foo', (_ws, _req, next) => next())
            .use('/foo', (_ws, _req, next) => next())
            .bootstrap(server);

        server.emit(
            'upgrade',
            { url: '/foo' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.deepStrictEqual(upgrade.ws.closeCalls, [
            { code: 1011, reason: 'No handler claimed the connection' }
        ]);
    });

    it('Close the connection when a handler throws', async (t: it.TestContext) => {
        t.mock.method(console, 'error', () => {});

        const fake = new SocketServerFake();
        const server = new EventEmitter() as Server;
        const calls: string[] = [];

        new SocketServer({}, fake)
            .use('/foo', () => {
                throw new Error('handler exploded');
            })
            .use('/foo', () => { calls.push('fn-02'); })
            .bootstrap(server);

        server.emit(
            'upgrade',
            { url: '/foo' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.deepStrictEqual(calls, []);
        t.assert.deepStrictEqual(upgrade.ws.closeCalls, [
            { code: 1011, reason: 'Handler threw an exception' }
        ]);
    });

    it('Reject with 404 when no route matches', (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = new EventEmitter() as Server;
        const writes: string[] = [];
        let destroyed = false;

        const duplex = {
            write: (chunk: unknown) => {
                writes.push(String(chunk));
                return true;
            },
            destroy: () => {
                destroyed = true;
            }
        } as unknown as Duplex;

        new SocketServer({}, fake)
            .use('/foo', () => {})
            .bootstrap(server);

        server.emit(
            'upgrade',
            { url: '/bar' } as IncomingMessage,
            duplex,
            Buffer.alloc(0)
        );

        t.assert.strictEqual(fake.upgrades.length, 0);
        t.assert.deepStrictEqual(writes, [ 'HTTP/1.1 404 Not Found\r\n\r\n' ]);
        t.assert.strictEqual(destroyed, true);
    });

    it('Detach the upgrade listener when the server closes', (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = new EventEmitter() as Server;

        new SocketServer({}, fake)
            .use('/foo', () => {})
            .bootstrap(server);

        t.assert.strictEqual(server.listenerCount('upgrade'), 1);
        server.emit('close');
        t.assert.strictEqual(server.listenerCount('upgrade'), 0);

        server.emit(
            'upgrade',
            { url: '/foo' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        t.assert.strictEqual(fake.upgrades.length, 0);
    });
});
