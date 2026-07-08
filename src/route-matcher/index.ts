/**
 * Public barrel of the route-matcher feature.
 *
 * Only {@link createRouteMatcher} is consumed outside the feature (by
 * {@link SocketServer}); `loosen` and `decodeParam` are internal helpers.
 */

export { createRouteMatcher } from './route-matcher.js';
