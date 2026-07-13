import type { EventEmitterDescriptor, EventEmitterInject } from './interfaces/index.js';

export class EventEmitter<T extends { [K in keyof T]: unknown[]; }> {
    #maxListeners = 10;
    #injected: Required<EventEmitterInject>;
    #events = new Map<string, {
        callback: (...a: unknown[]) => unknown;
        callOnce: boolean;
    }[]>();

    constructor(inject?: EventEmitterInject) {
        this.#injected = {
            console:    inject?.console ?? globalThis.console
        };
    }

    #getEvents(name: string): {
        callback: (...a: unknown[]) => unknown;
        callOnce: boolean;
    }[] {
        const events = this.#events.get(name) ?? [];
        if (
            Number.isFinite(this.#maxListeners) &&
            events.length >= this.#maxListeners
        ) throw new Error(`Max listeners for event "${name}" is reached`);

        if (!this.#events.has(name))
            this.#events.set(name, events);

        return events;
    }

    getMaxListeners(): number {
        return this.#maxListeners;
    }

    setMaxListeners(v: number) {
        if (v < 0) {
            throw new RangeError(`Expected an integer between 0 and infinity`);
        } else if (isNaN(v) || (Number.isFinite(v) && !Number.isInteger(v))) {
            throw new TypeError(`Expected an integer or Number.POSITIVE_INFINITY`);
        } else {
            this.#maxListeners = v;
        }
    }

    emit<
        U extends EventEmitterDescriptor<T>,
        K extends keyof U,
        A extends U[K]
    >(name: K, ...args: A): EventEmitter<T>;
    emit(name: string, ...args: unknown[]): EventEmitter<T> {
        const events = this.#events.get(name);
        if (!events) {
            if (name === 'error') {
                this.#injected.console.error(...args);
            }

            return this;
        }

        let i = 0;
        const callbacks: ((...a: unknown[]) => unknown)[] = [];
        while (i < events.length) {
            const { callback, callOnce } = events[i];
            callbacks.push(callback);
            if (callOnce) {
                events.splice(i, 1);
            } else {
                i++;
            }
        }

        if (events.length === 0) {
            this.#events.delete(name);
        }

        const reject = (err: unknown) => {
            const errorEvents = this.#events.get('error');
            if (
                err instanceof Error &&
                name !== 'error' &&
                errorEvents &&
                errorEvents.length > 0
            ) {
                (this as EventEmitter<{}>).emit('error', err);
            } else {
                this.#injected.console.error(err);
            }
        };

        for (const callback of callbacks) {
            try {
                let v = callback(...args);
                if (v instanceof Promise) {
                    v = v.catch(err => reject(err));
                }
            } catch (err) {
                reject(err);
            }
        }

        return this;
    }

    once<
        U extends EventEmitterDescriptor<T>,
        K extends keyof U,
        A extends U[K]
    >(
        name: K,
        callback: (...a: A) => unknown
    ): EventEmitter<T>;
    once(name: string, callback: (...a: unknown[]) => unknown): EventEmitter<T> {
        this.#getEvents(name).push({ callOnce: true, callback });
        return this;
    }

    off<
        U extends EventEmitterDescriptor<T>,
        K extends keyof U,
        A extends U[K]
    >(
        name: K,
        callback: (...a: A) => unknown
    ): EventEmitter<T>;
    off(name: string, callback: (...a: unknown[]) => unknown): EventEmitter<T> {
        const events = this.#events.get(name);
        if (!events) return this;

        const index = events.findIndex(x => x.callback === callback);
        if (index >= 0) events.splice(index, 1);
        if (events.length === 0) this.#events.delete(name);
        return this;
    }

    on<
        U extends EventEmitterDescriptor<T>,
        K extends keyof U,
        A extends U[K]
    >(
        name: K,
        callback: (...a: A) => unknown
    ): EventEmitter<T>;
    on(name: string, callback: (...a: unknown[]) => unknown): EventEmitter<T> {
        this.#getEvents(name).push({ callOnce: false, callback });
        return this;
    }
}