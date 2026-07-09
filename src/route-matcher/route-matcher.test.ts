import { describe, it } from 'node:test';

import { createRouteMatcher } from './route-matcher.js';

/**
 * Unit tests for {@link createRouteMatcher}: the match function it builds for
 * a single route, covering the Express-equivalent path-parsing pipeline
 * (pathless catch-all, param extraction, optional groups, wildcards,
 * trailing-slash tolerance, decoding and the removed `?` modifier).
 */
describe('route-matcher', () => {
    it('Matches any path when the pattern is undefined (pathless)', (t: it.TestContext) => {
        const matchFn = createRouteMatcher(undefined);
        const result = matchFn('/whatever/path');

        t.assert.notStrictEqual(result, false);
        if (result) {
            t.assert.strictEqual(result.path, '/whatever/path');
            t.assert.deepStrictEqual({ ...result.params }, {});
        }
    });

    it('Extracts a required param', (t: it.TestContext) => {
        const matchFn = createRouteMatcher('/user/:id');
        const result = matchFn('/user/123');

        t.assert.notStrictEqual(result, false);
        if (result) {
            t.assert.deepStrictEqual({ ...result.params }, { id: '123' });
        }
    });

    it('Extracts an optional group when present and absent', (t: it.TestContext) => {
        const matchFn = createRouteMatcher('/user{/:id}');

        const withId = matchFn('/user/123');
        const withoutId = matchFn('/user');

        t.assert.deepStrictEqual(withId ? { ...withId.params } : false, { id: '123' });
        t.assert.deepStrictEqual(withoutId ? { ...withoutId.params } : false, {});
    });

    it('Extracts a named wildcard as an array', (t: it.TestContext) => {
        const matchFn = createRouteMatcher('/files/*rest');
        const result = matchFn('/files/a/b/c');

        t.assert.deepStrictEqual(result ? { ...result.params } : false, { rest: [ 'a', 'b', 'c' ] });
    });

    it('Tolerates a trailing slash on the request path', (t: it.TestContext) => {
        const matchFn = createRouteMatcher('/user/:id');

        t.assert.notStrictEqual(matchFn('/user/123/'), false);
    });

    it('Decodes matched params', (t: it.TestContext) => {
        const matchFn = createRouteMatcher('/user/:name');
        const result = matchFn('/user/jos%C3%A9');

        t.assert.deepStrictEqual(result ? { ...result.params } : false, { name: 'josé' });
    });

    it('Rejects the removed :id? modifier (Express parity)', (t: it.TestContext) => {
        t.assert.throws(() => createRouteMatcher('/user/:id?'));
    });

    it('Matches only the exact path when end is true (the default)', (t: it.TestContext) => {
        const matchFn = createRouteMatcher('/api');

        t.assert.notStrictEqual(matchFn('/api'), false);
        t.assert.strictEqual(matchFn('/api/users'), false);
    });

    it('Matches a prefix (and its subpaths) when end is false', (t: it.TestContext) => {
        const matchFn = createRouteMatcher('/api', false);

        t.assert.notStrictEqual(matchFn('/api'), false);
        t.assert.notStrictEqual(matchFn('/api/users'), false);
        t.assert.notStrictEqual(matchFn('/api/a/b'), false);
        // Must respect segment boundaries: `/apix` is not under `/api`.
        t.assert.strictEqual(matchFn('/apix'), false);
        t.assert.strictEqual(matchFn('/other'), false);
    });

    it('Exposes the full request path (not just the prefix) on a prefix match', (t: it.TestContext) => {
        const matchFn = createRouteMatcher('/api', false);
        const result = matchFn('/api/users/42');

        t.assert.notStrictEqual(result, false);
        if (result) {
            t.assert.strictEqual(result.path, '/api/users/42');
        }
    });

    it('Still extracts params on a prefix match', (t: it.TestContext) => {
        const matchFn = createRouteMatcher('/user/:id', false);
        const result = matchFn('/user/7/messages');

        t.assert.notStrictEqual(result, false);
        if (result) {
            t.assert.strictEqual(result.path, '/user/7/messages');
            t.assert.deepStrictEqual({ ...result.params }, { id: '7' });
        }
    });
});
