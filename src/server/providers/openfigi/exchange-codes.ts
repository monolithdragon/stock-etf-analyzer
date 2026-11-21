/**
 * OpenFIGI (Bloomberg) `exchCode` → ISO 10383 MIC leképezés.
 *
 * Az OpenFIGI válasza NEM tartalmaz MIC-et és jegyzési pénznemet, csak Bloomberg tőzsdekódot.
 * Ezért csak IGAZOLT párokat veszünk fel: mindegyiket 2026-11-21-én az OpenFIGI `micCode`
 * kérésszűrőjével ellenőriztük (ISIN/ticker + micCode → a válasz exchCode-ja), a
 * `docs/DATA_SOURCES.md` 3.2 fejezete szerint. Ami nincs itt, az `unmappedVenue` lesz
 * (nem találunk ki MIC-et).
 *
 * Konvenció: a listing-azonosítóban az ÜZEMELTETŐI (operating) MIC-et használjuk
 * (pl. a Nasdaq szegmens-MIC-jei – XNGS, XNMS – helyett XNAS), hogy egy tőzsde egy azonosítót
 * kapjon (D-042). A szegmens-MIC → üzemeltetői MIC viszony az ISO 10383 lista része.
 */
export interface ExchangeMapping {
  readonly mic: string;
  readonly exchangeName: string;
  /** Mivel igazoltuk (átláthatóság). */
  readonly verifiedBy: string;
}

export const OPENFIGI_EXCHANGE_CODES: Readonly<Record<string, ExchangeMapping>> = {
  LN: {
    mic: 'XLON',
    exchangeName: 'London Stock Exchange',
    verifiedBy: 'micCode=XLON → LN (VWRA)',
  },
  GT: { mic: 'XETR', exchangeName: 'Xetra', verifiedBy: 'micCode=XETR → GT (VWCE)' },
  GF: { mic: 'XFRA', exchangeName: 'Börse Frankfurt', verifiedBy: 'micCode=XFRA → GF (VWCE)' },
  GS: { mic: 'XSTU', exchangeName: 'Börse Stuttgart', verifiedBy: 'micCode=XSTU → GS (VWCE)' },
  GD: { mic: 'XDUS', exchangeName: 'Börse Düsseldorf', verifiedBy: 'micCode=XDUS → GD (VWCE)' },
  GM: { mic: 'XMUN', exchangeName: 'Börse München', verifiedBy: 'micCode=XMUN → GM (VWCE)' },
  GH: { mic: 'XHAM', exchangeName: 'Börse Hamburg', verifiedBy: 'micCode=XHAM → GH (VWCE)' },
  NA: {
    mic: 'XAMS',
    exchangeName: 'Euronext Amsterdam',
    verifiedBy: 'micCode=XAMS → NA (VWCE, IWDA)',
  },
  SE: { mic: 'XSWX', exchangeName: 'SIX Swiss Exchange', verifiedBy: 'micCode=XSWX → SE (VWRA)' },
  IM: {
    mic: 'XMIL',
    exchangeName: 'Borsa Italiana',
    verifiedBy: 'micCode=MTAA → IM (VWCE); MTAA szegmens-MIC → XMIL',
  },
  UN: {
    mic: 'XNYS',
    exchangeName: 'New York Stock Exchange',
    verifiedBy: 'micCode=XNYS → UN (AAPL, SPY, KO)',
  },
  UP: { mic: 'ARCX', exchangeName: 'NYSE Arca', verifiedBy: 'micCode=ARCX → UP (AAPL, SPY, KO)' },
  UW: {
    mic: 'XNAS',
    exchangeName: 'Nasdaq',
    verifiedBy: 'ticker AAPL + micCode=XNGS → UW; XNGS szegmens-MIC → XNAS',
  },
  UQ: {
    mic: 'XNAS',
    exchangeName: 'Nasdaq',
    verifiedBy: 'ticker QQQ + micCode=XNMS → UQ; XNMS szegmens-MIC → XNAS',
  },
};

/**
 * Ország-szintű (kompozit) sor felismerése: a valós válaszokban a kompozit sor saját FIGI-je
 * azonos a `compositeFIGI`-vel (pl. VWCE `GR`, AAPL `US`). Ez nem konkrét tőzsde, MIC-et
 * nem kap. US részvénynél az ISIN-kérés alapból CSAK a kompozit sort adja, ezért a US-tőzsde
 * ISIN-ből nem határozható meg (KI-21).
 */
export function isCompositeRow(row: {
  readonly figi: string;
  readonly compositeFIGI?: string | null;
}): boolean {
  return (
    row.compositeFIGI !== undefined && row.compositeFIGI !== null && row.figi === row.compositeFIGI
  );
}
