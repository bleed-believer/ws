import { describe, it } from 'node:test';

import { SocketServerRouter } from './socket-server-router.js';

/**
 * Unit tests for {@link SocketServerRouter}, covering route registration
 * and the flattening logic performed by `routes()` for both simple and
 * nested (sub-router) registrations.
 */
describe('SocketServerRouter', () => {
    it('Resolve simple router', (t: it.TestContext) => {
        const routes = new SocketServerRouter()
            .use('foo', () => 'fn-01')
            .use('bar', () => 'fn-02')
            .routes()
            .map(x => ({
                path: x.path,
                name: x.callback(
                    {} as any,
                    {} as any,
                    () => {}
                )
            }));

        t.assert.deepStrictEqual(routes, [
            { path: '/foo', name: 'fn-01' },
            { path: '/bar', name: 'fn-02' },
        ]);
    });

    it('Resolve complex router', (t: it.TestContext) => {
        const routes = new SocketServerRouter()
            .use(() => 'fn-01')
            .use(new SocketServerRouter()
                .use(() => 'fn-02')
                .use('bleed', () => 'fn-03')
                .use('break', () => 'fn-04')
            )
            .use('foo', () => 'fn-05')
            .use('bar', () => 'fn-06')
            .use('bak', new SocketServerRouter()
                .use(() => 'fn-07')
                .use('lol', () => 'fn-08')
                .use('kek', () => 'fn-09')
            )
            .routes()
            .map(x => ({
                path: x.path,
                name: x.callback(
                    {} as any,
                    {} as any,
                    () => {}
                )
            }));

        t.assert.deepStrictEqual(routes, [
            { path: undefined, name: 'fn-01' },
            { path: undefined, name: 'fn-02' },
            { path: '/bleed', name: 'fn-03' },
            { path: '/break', name: 'fn-04' },
            { path: '/foo', name: 'fn-05' },
            { path: '/bar', name: 'fn-06' },
            { path: '/bak', name: 'fn-07' },
            { path: '/bak/lol', name: 'fn-08' },
            { path: '/bak/kek', name: 'fn-09' },
        ]);
    });
});