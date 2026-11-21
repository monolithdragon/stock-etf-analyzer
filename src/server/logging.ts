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
