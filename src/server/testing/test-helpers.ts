/**
 * CSAK tesztekhez: fixture-betöltés és hamis `fetch`. Teszt sosem hív élő API-t
 * (ARCHITECTURE 8.) – minden felfelé irányuló hívás ezen a hamis `fetch`-en megy át.
 */
import type { FetchLike } from '../http/request-json';

/**
 * Fixture betöltése a `src/server/providers/<adapter>/__fixtures__/` mappából.
 * - `{ _fixture, response }` burok → a `response` (tömb válaszoknál);
 * - egyébként a `_fixture` fejlécet levesszük, a többi az eredeti válasz.
 *
 * A `jest.requireActual` (a Jest saját, típusos betöltője) ehhez a fájlhoz képest old fel,
 * így nem kell Node-típus (`node:fs`) a projektbe. A Jest gyorsítótáraz: a visszaadott
 * objektumot NEM módosítjuk (másolatot adunk).
 */
export function loadFixture(adapter: string, file: string): unknown {
  const raw = jest.requireActual<Record<string, unknown>>(
    `../providers/${adapter}/__fixtures__/${file}`,
  );
  const copy = structuredClone(raw);
  if ('response' in copy) return copy.response;
  const { _fixture: _ignored, ...rest } = copy;
  return rest;
}

export interface FakeCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

export type FakeRoute = (
  url: string,
  init: RequestInit | undefined,
) => Response | Promise<Response> | 'NETWORK_ERROR' | 'HANG';

/** Hamis fetch: a hívásokat rögzíti, a választ a `route` adja. `HANG` = soha nem válaszol (timeout-teszt). */
export function fakeFetch(route: FakeRoute): FetchLike & { readonly calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const outcome = await route(url, init);
    if (outcome === 'NETWORK_ERROR') throw new TypeError('fetch failed');
    if (outcome === 'HANG') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    }
    return outcome;
  };
  return Object.assign(impl, { calls });
}

export const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export const FIXED_NOW = new Date('2026-11-21T12:00:00Z');
export const fixedNow = (): Date => FIXED_NOW;
