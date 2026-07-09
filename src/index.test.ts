import type { AddressInfo } from 'node:net';

import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import { once } from 'node:events';
import WebSocket from 'ws';

import { SocketServer, SocketServerRouter } from './index.js';

/**
 * Spins up a real HTTP server on a random local port, attaches a
 * {@link SocketServer} to it, and registers the routes declared by
 * `configure` through a {@link SocketServerRouter}. A cleanup hook closes the
 * server once the test finishes.
 *
 * @param configure - Registers the routes under test on the given router.
 * @param t - Test context used to schedule the teardown.
 * @returns The base `ws://` URL the server is listening on.
 */
async function launch(
    configure: (router: SocketServerRouter) => void,
    t: it.TestContext
): Promise<string> {
    const server = createServer();
    const router = new SocketServerRouter();
    configure(router);

    new SocketServer({ server }).use(router).bind();

    server.listen(0);
    await once(server, 'listening');

    t.after(() => new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
    }));

    const { port } = server.address() as AddressInfo;
    return `ws://localhost:${port}`;
}

describe('SocketServer (e2e)', () => {
    it('Accepts a connection on a registered route and echoes messages', async (t: it.TestContext) => {
        const url = await launch(router => router
            .use('echo', ws => {
                // Uses the `ws`-native EventEmitter API (`ws.on`), which
                // `WebSocketObject` must preserve.
                ws.on('message', data => {
                    ws.send(`echo: ${data}`);
                });
            }), t);

        const client = new WebSocket(`${url}/echo`);
        await once(client, 'open');

        client.send('hello');
        const [ data ] = await once(client, 'message');
        t.assert.strictEqual(data.toString(), 'echo: hello');

        client.close();
        await once(client, 'close');
    });

    it('Exposes the route params and matched path to the handler', async (t: it.TestContext) => {
        const url = await launch(router => router
            .use('user/:id/posts/:postId', ws => {
                ws.send(JSON.stringify({
                    params: ws.params,
                    path: ws.path
                }));
            }), t);

        const client = new WebSocket(`${url}/user/42/posts/7`);
        const message = once(client, 'message');

        const [ data ] = await message;
        t.assert.deepStrictEqual(JSON.parse(data.toString()), {
            params: { id: '42', postId: '7' },
            path: '/user/42/posts/7'
        });

        client.close();
        await once(client, 'close');
    });

    it('Emits `connection` on the server for each upgraded socket', async (t: it.TestContext) => {
        const server = createServer();
        const app = new SocketServer({ server })
            .use(new SocketServerRouter().use('room', () => {}))
            .bind();

        const connections: unknown[] = [];
        app.on('connection', ws => { connections.push(ws); });

        server.listen(0);
        await once(server, 'listening');
        t.after(() => { if (server.listening) server.close(); });

        const { port } = server.address() as AddressInfo;
        const client = new WebSocket(`ws://localhost:${port}/room`);
        await once(client, 'open');

        t.assert.strictEqual(connections.length, 1);

        client.close();
        await once(client, 'close');
    });

    it('Routes connections through nested routers', async (t: it.TestContext) => {
        const url = await launch(router => router
            .use('api', new SocketServerRouter()
                .use('chat/:room', ws => {
                    ws.send(ws.path);
                })
            ), t);

        const client = new WebSocket(`${url}/api/chat/lobby`);
        const message = once(client, 'message');

        const [ data ] = await message;
        t.assert.strictEqual(data.toString(), '/api/chat/lobby');

        client.close();
        await once(client, 'close');
    });

    it('Starts routing when bind() runs while the server is already listening', async (t: it.TestContext) => {
        const server = createServer();
        server.listen(0);
        await once(server, 'listening');
        t.after(() => { if (server.listening) server.close(); });

        // bind() is called after the server is already listening: it attaches
        // the upgrade handler regardless of the server's current state.
        new SocketServer({ server })
            .use(new SocketServerRouter().use('late', ws => { ws.send('ok'); }))
            .bind();

        const { port } = server.address() as AddressInfo;
        const client = new WebSocket(`ws://localhost:${port}/late`);

        const [ data ] = await once(client, 'message');
        t.assert.strictEqual(data.toString(), 'ok');

        client.close();
        await once(client, 'close');
    });

    it('Rejects unmatched paths with a 404 response', async (t: it.TestContext) => {
        const url = await launch(router => router
            .use('known', () => {}), t);

        const client = new WebSocket(`${url}/unknown`);

        const [ , res ] = await once(client, 'unexpected-response');
        t.assert.strictEqual(res.statusCode, 404);
        // The 404 is framed with an explicit Content-Length so the client
        // reads a complete body instead of hanging on the connection.
        t.assert.strictEqual(res.headers['content-length'], '9');
    });

    it('Passes control to the next matching handler with next()', async (t: it.TestContext) => {
        const trace: string[] = [];
        const url = await launch(router => router
            .use((_ws, _req, next) => {
                trace.push('global');
                next();
            })
            .use('room', ws => {
                trace.push('room');
                ws.send('claimed');
            })
            .use('room', () => {
                trace.push('unreachable');
            }), t);

        const client = new WebSocket(`${url}/room`);
        const message = once(client, 'message');

        const [ data ] = await message;
        t.assert.strictEqual(data.toString(), 'claimed');
        t.assert.deepStrictEqual(trace, [ 'global', 'room' ]);

        client.close();
        await once(client, 'close');
    });

    it('Closes with 1011 when no handler claims the connection', async (t: it.TestContext) => {
        const url = await launch(router => router
            .use('open', (_ws, _req, next) => next()), t);

        const client = new WebSocket(`${url}/open`);

        const [ code, reason ] = await once(client, 'close');
        t.assert.strictEqual(code, 1011);
        t.assert.strictEqual(reason.toString(), 'No handler claimed the connection');
    });

    it('Closes with 1011 when a handler throws an exception', async (t: it.TestContext) => {
        const error = t.mock.method(console, 'error', () => {});
        const url = await launch(router => router
            .use('boom', async () => {
                throw new Error('kaboom');
            }), t);

        const client = new WebSocket(`${url}/boom`);

        const [ code, reason ] = await once(client, 'close');
        t.assert.strictEqual(code, 1011);
        t.assert.strictEqual(reason.toString(), 'Handler threw an exception');
        t.assert.strictEqual(error.mock.callCount(), 1);
    });

    it('Resumes routing on a server restart when bind() is wired to `listening`', async (t: it.TestContext) => {
        const server = createServer();
        const app = new SocketServer({ server })
            .use(new SocketServerRouter().use('ping', ws => { ws.send('pong'); }))
            .bind();

        // Opt-in re-bind: on every (re)start of the server, re-attach routing.
        server.on('listening', () => app.bind());
        t.after(() => { if (server.listening) server.close(); });

        // First lifecycle: start, connect, then tear the socket layer and the
        // server down (the server is the caller's to stop).
        server.listen(0);
        await once(server, 'listening');
        const first = (server.address() as AddressInfo).port;

        const c1 = new WebSocket(`ws://localhost:${first}/ping`);
        t.assert.strictEqual((await once(c1, 'message'))[0].toString(), 'pong');
        c1.close();
        await once(c1, 'close');

        app.close();
        server.close();
        await once(server, 'close');

        // Second lifecycle: the same Server is started again; the `listening`
        // hook re-binds routing without reconstructing the SocketServer.
        server.listen(0);
        await once(server, 'listening');
        const second = (server.address() as AddressInfo).port;

        const c2 = new WebSocket(`ws://localhost:${second}/ping`);
        t.assert.strictEqual((await once(c2, 'message'))[0].toString(), 'pong');
        c2.close();
        await once(c2, 'close');
    });

    it('Closes live connections on close() but leaves the HTTP server running', async (t: it.TestContext) => {
        const server = createServer();
        const app = new SocketServer({ server })
            .use(new SocketServerRouter().use('any', () => {}))
            .bind();

        server.listen(0);
        await once(server, 'listening');
        t.after(() => { if (server.listening) server.close(); });

        const { port } = server.address() as AddressInfo;
        const client = new WebSocket(`ws://localhost:${port}/any`);
        await once(client, 'open');

        const clientClosed = once(client, 'close');
        app.close();

        // The live connection is dropped, but the HTTP server the caller owns
        // keeps listening.
        await clientClosed;
        t.assert.strictEqual(server.listening, true);
    });
});
