/**
 * Proxy-napló (ARCHITECTURE 10.): egy JSON-sor kérésenként.
 * SOHA nincs benne: API-kulcs, User-Agent (e-mail), teljes URL lekérdezéssel, portfólióadat.
 */
export interface ServerLogEntry {
  readonly route: string;
  readonly status: number;
  readonly latencyMs: number;
  readonly provider?: string;
  readonly errorKind?: string;
  /** Tartalékra váltás előtti sikertelen kísérletek, pl. `fmp:UNAVAILABLE` (PHASE 04B). */
  readonly fallbackFrom?: string;
}

export interface ServerLogger {
  info(entry: ServerLogEntry): void;
}

export const consoleServerLogger: ServerLogger = {
  info(entry) {
    console.log(JSON.stringify({ level: 'info', ...entry }));
  },
};

export const silentServerLogger: ServerLogger = { info() {} };
