export type EventEmitterDescriptor<T extends Record<string, unknown[]>> =
    Omit<T, 'error'> &
    { error: [ error: Error ]; }