type RemoveTail<S extends string, Tail extends string> =
    S extends `${infer P}${Tail}` ? P : S;

type GetRouteParameter<S extends string> = RemoveTail<
    RemoveTail<RemoveTail<S, `/${string}`>, `-${string}`>,
    `.${string}`
>;

type ExtractParams<Route extends string> =
    Route extends `${string}:${infer Rest}`
        ? (GetRouteParameter<Rest> extends `${infer Name}?`
            ? { [K in Name]?: string }
            : { [K in GetRouteParameter<Rest>]: string })
          & (Rest extends `${GetRouteParameter<Rest>}${infer Next}`
              ? ExtractParams<Next>
              : {})
        : Route extends `${string}*${infer Rest}`
            ? { [K in GetRouteParameter<Rest>]: string[] }   // ← wildcard: array, no string
              & (Rest extends `${GetRouteParameter<Rest>}${infer Next}`
                  ? ExtractParams<Next>
                  : {})
            : {};

export type RouteParameters<P extends string> = ExtractParams<P>;