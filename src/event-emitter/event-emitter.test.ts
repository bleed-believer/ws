import { EventEmitter } from './event-emitter.js';
import { describe, it } from 'node:test';

describe('EventEmitter', () => {
    it('Create and emit simple events', (t: it.TestContext) => {
        const messages: string[] = [];
        const emitter = new EventEmitter<{ message: [ text: string ] }>();
        emitter.on('message', m => messages.push(m));
        emitter.emit('message', 'foo');
        emitter.emit('message', 'bar');
        t.assert.deepStrictEqual(messages, [ 'foo', 'bar' ]);
    });

    it('Create and emit events (on & once)', (t: it.TestContext) => {
        const messages: string[] = [];
        const emitter = new EventEmitter<{ write: [ value: number ] }>();
        emitter.on('write', v => messages.push(`on: ${v}`));
        emitter.once('write', v => messages.push(`once: ${v}`));
        emitter.emit('write', 1);
        emitter.emit('write', 2);
        emitter.emit('write', 3);
        emitter.emit('write', 4);

        t.assert.deepStrictEqual(messages, [
            'on: 1',
            'once: 1',
            'on: 2',
            'on: 3',
            'on: 4',
        ]);
    });

    it('Emit an event, and fails (registered error event)', (t: it.TestContext) => {
        const messages: string[] = [];
        const emitter = new EventEmitter<{ send: [ text: string ] }>();
        emitter.on('send', () => { throw new Error('joder chaval'); });
        emitter.on('error', err => messages.push(err.message));
        emitter.emit('send', 'hola');
        t.assert.deepStrictEqual(messages, [ 'joder chaval' ]);
    });

    it('Emit an event, and fails (fallback to console.error)', (t: it.TestContext) => {
        const messages: string[] = [];
        const emitter = new EventEmitter<{ send: [ text: string ] }>({
            console: {
                error(err) {
                    if (err instanceof Error) messages.push(err.message);
                }
            }
        });

        emitter.on('send', () => { throw new Error('joder chaval'); });
        emitter.emit('send', 'hola');
        t.assert.deepStrictEqual(messages, [ 'joder chaval' ]);
    });

    it('Reached maximum allowed listeners', (t: it.TestContext) => {
        const emitter = new EventEmitter<{ send: [ text: string ] }>();
        emitter.setMaxListeners(2);
        let i = 0;

        try {
            emitter.on('send', m => console.log(m));
            i++;
            emitter.on('send', m => console.log(m));
            i++;
            emitter.on('send', m => console.log(m));
            i++;

            throw new Error('Expected to fail here!');

        } catch (err: any) {
            t.assert.strictEqual(i, 2);
            t.assert.strictEqual(err?.message, `Max listeners for event "send" is reached`);
        }
    });

    it('On error event fails: Use console.error as fallback', (t: it.TestContext) => {
        const stackTrace: string[] = [];
        const emitter = new EventEmitter<{ write: [ text: string ] }>({
            console: {
                error(e) {
                    if (e instanceof Error) stackTrace.push(e.message);
                }
            }
        });

        emitter.on('error', () => { throw new Error('Dame tu cosita... Ay! Ay!') });
        emitter.on('write', () => { throw new Error('Buaaa!') });
        emitter.emit('write', 'joder');
        t.assert.deepStrictEqual(stackTrace, [ 'Dame tu cosita... Ay! Ay!' ]);
    });
});