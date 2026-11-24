/**
 * Egységes lekérési állapot a képernyőkhöz (PHASE 12).
 *
 * A use case `Result`-ot ad (várt hiba = `AppError`, nem kivétel). A hook ebből állapotgépet
 * készít: `loading` → `success` | `error`, `reload()`-dal újrapróbálható. A `refreshing` jelzi,
 * hogy egy meglévő eredmény mellett fut újratöltés (a régi adat addig látszik, jelölve).
 *
 * Versenyhelyzet: csak a legutóbb indított kérés eredménye kerül az állapotba; a leválasztott
 * komponensen nincs állapotfrissítés.
 */
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

import { AppErrors, type AppError, type Result } from '@/domain';

export type AsyncState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: AppError }
  | { readonly status: 'success'; readonly data: T };

export interface AsyncResult<T> {
  readonly state: AsyncState<T>;
  /** Újratöltés folyamatban egy már meglévő eredmény mellett. */
  readonly refreshing: boolean;
  readonly reload: () => void;
}

/** Váratlan kivétel (programhiba) is hibaállapot legyen, ne fehér képernyő. */
function unexpected(cause: unknown): AppError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return AppErrors.calculationInvalid(`Váratlan hiba: ${message}`);
}

export function useAsyncResult<T>(
  load: () => Promise<Result<T, AppError>>,
  deps: DependencyList,
  options: { readonly enabled?: boolean } = {},
): AsyncResult<T> {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestId = useRef(0);
  const loadRef = useRef(load);
  const stateRef = useRef(state);
  const lastReloadToken = useRef(0);

  // A ref-eket effektben frissítjük (render közben tilos); az effektek deklarációs sorrendben
  // futnak, így a lenti lekérő effekt már a legfrissebb `load`-ot és állapotot látja.
  useEffect(() => {
    loadRef.current = load;
    stateRef.current = state;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    requestId.current += 1;
    const current = requestId.current;
    let active = true;
    // Csak kézi újratöltésnél marad látható a régi eredmény (jelölve); ha a bemenet változott
    // (pl. másik ticker), a régi adat nem tartozik az új kéréshez → betöltési állapot.
    const isManualReload = reloadToken !== lastReloadToken.current;
    lastReloadToken.current = reloadToken;
    if (isManualReload && stateRef.current.status === 'success') {
      setRefreshing(true);
    } else {
      setState({ status: 'loading' });
    }
    loadRef
      .current()
      .then(
        (result): AsyncState<T> =>
          result.ok
            ? { status: 'success', data: result.value }
            : { status: 'error', error: result.error },
        (cause: unknown): AsyncState<T> => ({ status: 'error', error: unexpected(cause) }),
      )
      .then((next) => {
        if (!active || current !== requestId.current) return;
        setState(next);
        setRefreshing(false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // A `deps` a hívó felelőssége (mint a useEffect-nél); a `load` mindig a legfrissebb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken, enabled]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);
  return { state, refreshing, reload };
}
