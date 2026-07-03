import type { AddressInfo } from 'node:net';

import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import { once } from 'node:events';
import WebSocket from 'ws';

import { SocketRouter } from './socket-router.js';
import { Socket } from './socket.js';

async function launch(socket: Socket, t: it.TestContext): Promise<string> {
    const server = createServer();
    socket.bootstrap(server);

    server.listen(0);
    await once(server, 'listening');

    t.after(() => new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
    }));

    const { port } = server.address() as AddressInfo;
    return `ws://localhost:${port}`;
}

describe('Socket (e2e)', () => {
    it('Accepts a connection on a registered route and echoes messages', async (t: it.TestContext) => {
        const app = new Socket()
            .use('echo', ws => {
                ws.addEventListener('message', e => {
                    ws.send(`echo: ${e.data}`);
                });
            });

        const url = await launch(app, t);
        const client = new WebSocket(`${url}/echo`);
        await once(client, 'open');

        client.send('hello');
        const [ data ] = await once(client, 'message');
        t.assert.strictEqual(data.toString(), 'echo: hello');

        client.close();
        await once(client, 'close');
    });

    it('Exposes the route params and matched path to the handler', async (t: it.TestContext) => {
        const app = new Socket()
            .use('user/:id/posts/:postId', ws => {
                ws.send(JSON.stringify({
                    params: ws.params,
                    path: ws.path
                }));
            });

        const url = await launch(app, t);
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

    it('Routes connections through nested routers', async (t: it.TestContext) => {
        const app = new Socket()
            .use('api', new SocketRouter()
                .use('chat/:room', ws => {
                    ws.send(ws.path);
                })
            );

        const url = await launch(app, t);
        const client = new WebSocket(`${url}/api/chat/lobby`);
        const message = once(client, 'message');

        const [ data ] = await message;
        t.assert.strictEqual(data.toString(), '/api/chat/lobby');

        client.close();
        await once(client, 'close');
    });

    it('Rejects unmatched paths with a 404 response', async (t: it.TestContext) => {
        const app = new Socket()
            .use('known', () => {});

        const url = await launch(app, t);
        const client = new WebSocket(`${url}/unknown`);

        const [ , res ] = await once(client, 'unexpected-response');
        t.assert.strictEqual(res.statusCode, 404);
    });

    it('Passes control to the next matching handler with next()', async (t: it.TestContext) => {
        const trace: string[] = [];
        const app = new Socket()
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
            });

        const url = await launch(app, t);
        const client = new WebSocket(`${url}/room`);
        const message = once(client, 'message');

        const [ data ] = await message;
        t.assert.strictEqual(data.toString(), 'claimed');
        t.assert.deepStrictEqual(trace, [ 'global', 'room' ]);

        client.close();
        await once(client, 'close');
    });

    it('Closes with 1011 when no handler claims the connection', async (t: it.TestContext) => {
        const app = new Socket()
            .use('open', (_ws, _req, next) => next());

        const url = await launch(app, t);
        const client = new WebSocket(`${url}/open`);

        const [ code, reason ] = await once(client, 'close');
        t.assert.strictEqual(code, 1011);
        t.assert.strictEqual(reason.toString(), 'No handler claimed the connection');
    });

    it('Closes with 1011 when a handler throws an exception', async (t: it.TestContext) => {
        const error = t.mock.method(console, 'error', () => {});
        const app = new Socket()
            .use('boom', async () => {
                throw new Error('kaboom');
            });

        const url = await launch(app, t);
        const client = new WebSocket(`${url}/boom`);

        const [ code, reason ] = await once(client, 'close');
        t.assert.strictEqual(code, 1011);
        t.assert.strictEqual(reason.toString(), 'Handler threw an exception');
        t.assert.strictEqual(error.mock.callCount(), 1);
    });

    it('Detaches the upgrade listener when the server closes', async (t: it.TestContext) => {
        const server = createServer();
        new Socket()
            .use('any', () => {})
            .bootstrap(server);

        t.assert.strictEqual(server.listenerCount('upgrade'), 1);

        server.listen(0);
        await once(server, 'listening');
        await new Promise(resolve => server.close(resolve));

        t.assert.strictEqual(server.listenerCount('upgrade'), 0);
    });
});
