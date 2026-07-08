import { describe, it } from 'node:test';

import { loosen } from './route-matcher.loosen.js';

/**
 * Unit tests for {@link loosen}: the trailing-slash normalization Express 5
 * applies to route patterns before matching.
 */
describe('route-matcher.loosen', () => {
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
