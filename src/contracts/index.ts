/**
 * Contracts: a kliens és a proxy KÖZÖS, verziózott szerződése (zod sémák, DTO-k, mapperek).
 * Importálhat: `zod`, `@/domain`. Nem importálhat: React Native, Expo, `src/server`, `src/infrastructure`.
 */
export * from './api-envelope';
export * from './quote';
export * from './shared';
