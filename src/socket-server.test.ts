import type { IncomingMessage } from 'node:http';
import type { Server } from './interfaces/index.js';
import type { Duplex } from 'node:stream';

import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { SocketServerRouter } from './socket-server-router.js';
import { SocketServerFake } from './socket-server.fake.js';
import { SocketServer } from './socket-server.js';

/**
 * Builds a minimal {@link Server} stand-in around an `EventEmitter`, adding
 * the `listening`/`close()` surface the new {@link SocketServer} relies on.
 * `close()` calls are counted so lifecycle tests can assert on them.
 */
function fakeServer(listening = true): Server & { closeCount: number } {
    const server = new EventEmitter() as Server & { closeCount: number };
    server.closeCount = 0;
    Object.defineProperty(server, 'listening', { get: () => listening });
    (server as Server).close = () => {
        server.closeCount++;
        return server;
    };
    return server;
}

/**
 * Unit tests for {@link SocketServer}, using {@link SocketServerFake} to
 * simulate upgrades without opening real network sockets: route matching,
 * param extraction, the `next()` chain, error handling, 404 rejection and
 * `close()` teardown. The server is attached at construction time and routes
 * are registered through a {@link SocketServerRouter}.
 */
describe('SocketServer', () => {
    it('Attend a connection with a static path', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();
        const calls: string[] = [];

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/foo', () => { calls.push('foo'); })
            );

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
        const server = fakeServer();

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/user/:id/:action', () => {})
            );

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
        const server = fakeServer();
        const calls: string[] = [];

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use(() => { calls.push('any'); })
            );

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
        const server = fakeServer();
        const calls: string[] = [];

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/foo', (_ws, _req, next) => {
                    calls.push('fn-01');
                    next();
                })
                .use('/foo', () => { calls.push('fn-02'); })
            );

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

    it('Exposes each handler the params of its own route while it runs (Express req.params parity)', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();
        const seen: Record<string, unknown>[] = [];

        // Mirrors Express: `ws.params` is a single mutable reference that is
        // reassigned to the currently executing handler's matched params.
        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use((ws, _req, next) => { seen.push({ ...ws.params }); next(); })
                .use('/user/:id', (ws, _req, next) => { seen.push({ ...ws.params }); next(); })
                .use('/user/:id', ws => { seen.push({ ...ws.params }); })
            );

        server.emit(
            'upgrade',
            { url: '/user/7' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.deepStrictEqual(seen, [ {}, { id: '7' }, { id: '7' } ]);
        // After the chain, the reference reflects the claiming handler.
        t.assert.deepStrictEqual({ ...upgrade.ws.params }, { id: '7' });
    });

    it('Stop the chain when a handler does not call next()', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();
        const calls: string[] = [];

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/foo', () => { calls.push('fn-01'); })
                .use('/foo', () => { calls.push('fn-02'); })
            );

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
        const server = fakeServer();

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/foo', (_ws, _req, next) => next())
                .use('/foo', (_ws, _req, next) => next())
            );

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
        const fake = new SocketServerFake();
        const server = fakeServer();
        const calls: string[] = [];
        const error = new Error('handler exploded');

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/foo', () => {
                    throw error;
                })
                .use('/foo', () => { calls.push('fn-02'); })
            );

        server.emit(
            'upgrade',
            { url: '/foo' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.deepStrictEqual(calls, []);
        t.assert.deepStrictEqual(fake.errors, [ error ]);
        t.assert.deepStrictEqual(upgrade.ws.closeCalls, [
            { code: 1011, reason: 'Handler threw an exception' }
        ]);
    });

    it('Reject with 404 when no route matches', (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();
        const ends: string[] = [];

        const duplex = {
            end: (chunk: unknown) => {
                ends.push(String(chunk));
            }
        } as unknown as Duplex;

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/foo', () => {})
            );

        server.emit(
            'upgrade',
            { url: '/bar' } as IncomingMessage,
            duplex,
            Buffer.alloc(0)
        );

        t.assert.strictEqual(fake.upgrades.length, 0);
        t.assert.deepStrictEqual(ends, [
            'HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'
        ]);
    });

    it('Does not normalize dot-segments in the request path (Express parity)', (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();
        const ends: string[] = [];

        const duplex = {
            end: (chunk: unknown) => {
                ends.push(String(chunk));
            }
        } as unknown as Duplex;

        // `/admin/../public` must NOT collapse to `/public` and reach the
        // handler; Express's `parseurl` keeps `..` as a literal segment.
        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/public', () => {})
            );

        server.emit(
            'upgrade',
            { url: '/admin/../public' } as IncomingMessage,
            duplex,
            Buffer.alloc(0)
        );

        t.assert.strictEqual(fake.upgrades.length, 0);
        t.assert.deepStrictEqual(ends, [
            'HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'
        ]);
    });

    it('Does not strip the authority of a protocol-relative request path', (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();
        const ends: string[] = [];

        const duplex = {
            end: (chunk: unknown) => {
                ends.push(String(chunk));
            }
        } as unknown as Duplex;

        // `//evil.com/foo` must NOT be resolved to `/foo` and reach the
        // handler; the WHATWG URL parser would treat `evil.com` as a host.
        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/foo', () => {})
            );

        server.emit(
            'upgrade',
            { url: '//evil.com/foo' } as IncomingMessage,
            duplex,
            Buffer.alloc(0)
        );

        t.assert.strictEqual(fake.upgrades.length, 0);
        t.assert.deepStrictEqual(ends, [
            'HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'
        ]);
    });

    it('Extract a wildcard param as an array of segments', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/files/*rest', () => {})
            );

        server.emit(
            'upgrade',
            { url: '/files/a/b/c' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.strictEqual(upgrade.ws.path, '/files/a/b/c');
        t.assert.deepStrictEqual({ ...upgrade.ws.params }, { rest: [ 'a', 'b', 'c' ] });
    });

    it('Extract multiple params within a single segment', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/file/:name.:ext', () => {})
            );

        server.emit(
            'upgrade',
            { url: '/file/report.pdf' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.deepStrictEqual({ ...upgrade.ws.params }, { name: 'report', ext: 'pdf' });
    });

    it('Match an optional group ({/:id}) when the segment is present', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/user{/:id}', () => {})
            );

        server.emit(
            'upgrade',
            { url: '/user/123' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.strictEqual(upgrade.ws.path, '/user/123');
        t.assert.deepStrictEqual({ ...upgrade.ws.params }, { id: '123' });
    });

    it('Match an optional group ({/:id}) when the segment is absent', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/user{/:id}', () => {})
            );

        server.emit(
            'upgrade',
            { url: '/user' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        t.assert.strictEqual(fake.upgrades.length, 1);
        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.strictEqual(upgrade.ws.path, '/user');
        t.assert.deepStrictEqual({ ...upgrade.ws.params }, {});
    });

    it('Match several optional groups ({/:id}{/:action}) independently', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();
        const results: Record<string, unknown>[] = [];

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/user{/:id}{/:action}', ws => { results.push({ ...ws.params }); })
            );

        for (const url of [ '/user', '/user/5', '/user/5/edit' ]) {
            server.emit(
                'upgrade',
                { url } as IncomingMessage,
                {} as unknown as Duplex,
                Buffer.alloc(0)
            );
        }

        await Promise.all(fake.upgrades.map(u => u.done));

        t.assert.deepStrictEqual(results, [
            {},
            { id: '5' },
            { id: '5', action: 'edit' }
        ]);
    });

    it('Tolerate a trailing slash on the request path (Express parity)', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();

        new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/user/:id', () => {})
            );

        server.emit(
            'upgrade',
            { url: '/user/123/' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        t.assert.strictEqual(fake.upgrades.length, 1);
        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        t.assert.deepStrictEqual({ ...upgrade.ws.params }, { id: '123' });
    });

    it('Reject the removed :id? syntax when the route is registered, matching Express', (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer();

        // Express 5 / path-to-regexp v8 dropped the `?` modifier; the
        // optional group `{/:id}` must be used instead. The route matcher is
        // built while `use()` registers the router, so the throw surfaces there.
        t.assert.throws(() => {
            new SocketServer({ server }, fake)
                .use(new SocketServerRouter()
                    .use('/user/:id?' as string, () => {})
                );
        });
    });

    it('Close every connected client and stop the server on close()', async (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer(true);

        const app = new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/foo', () => {})
            );

        server.emit(
            'upgrade',
            { url: '/foo' } as IncomingMessage,
            {} as unknown as Duplex,
            Buffer.alloc(0)
        );

        const [ upgrade ] = fake.upgrades;
        await upgrade.done;

        // The handler claimed the connection, so it is still open until close().
        t.assert.deepStrictEqual(upgrade.ws.closeCalls, []);

        app.close();

        t.assert.deepStrictEqual(upgrade.ws.closeCalls, [
            { code: undefined, reason: undefined }
        ]);
        t.assert.strictEqual(server.closeCount, 1);
    });

    it('Leave an already-stopped server untouched on close()', (t: it.TestContext) => {
        const fake = new SocketServerFake();
        const server = fakeServer(false);

        const app = new SocketServer({ server }, fake)
            .use(new SocketServerRouter()
                .use('/foo', () => {})
            );

        app.close();

        t.assert.strictEqual(server.closeCount, 0);
    });
});
