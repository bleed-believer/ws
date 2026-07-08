import { describe, it } from 'node:test';

import { decodeParam } from './route-matcher.decode-param.js';

/**
 * Unit tests for {@link decodeParam}: percent-decoding of matched route
 * parameters, tolerating malformed sequences instead of throwing.
 */
describe('route-matcher.decode-param', () => {
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
