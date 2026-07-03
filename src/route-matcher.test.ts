import { createRouteMatcher, decodeParam, loosen } from './route-matcher.js';
import { describe, it } from 'node:test';

/**
 * Unit tests for {@link route-matcher}, covering the Express-equivalent
 * path-parsing pipeline: {@link loosen}, {@link decodeParam} and the match
 * function built by {@link createRouteMatcher}.
 */
describe('route-matcher', () => {
    describe('loosen', () => {
        it('Strips trailing slashes', (t: it.TestContext) => {
            t.assert.strictEqual(loosen('/user/'), '/user');
            t.assert.strictEqual(loosen('/user///'), '/user');
        });

        it('Leaves a path without trailing slash untouched', (t: it.TestContext) => {
            t.assert.strictEqual(loosen('/user/:id'), '/user/:id');
        });

        it('Leaves the root path untouched', (t: it.TestContext) => {
            t.assert.strictEqual(loosen('/'), '/');
        });
    });

    describe('decodeParam', () => {
        it('Decodes percent-encoded values', (t: it.TestContext) => {
            t.assert.strictEqual(decodeParam('jos%C3%A9'), 'josé');
        });

        it('Returns empty strings untouched', (t: it.TestContext) => {
            t.assert.strictEqual(decodeParam(''), '');
        });

        it('Returns malformed sequences untouched instead of throwing', (t: it.TestContext) => {
            t.assert.strictEqual(decodeParam('%E0%A4%A'), '%E0%A4%A');
        });
    });

    describe('createRouteMatcher', () => {
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
    });
});
