/**
 * Magyar UI-szövegek egy helyen (D-019). Később innen lehet i18n-t építeni.
 * Komponensben ne írj be közvetlen szöveget, hanem ezt használd.
 */
export const strings = {
  appName: 'Stock & ETF Analyzer',
  disclaimer:
    'Elemzési eszköz, saját használatra. Nem befektetési tanács, és nem garantál hozamot.',
  common: {
    unknown: 'ismeretlen',
    notSet: 'nincs megadva',
  },
  home: {
    title: 'Kezdőlap',
    tagline: 'Részvények, ETF-ek és portfólió átlátható, forrásolt elemzése.',
    statusTitle: 'Fejlesztési állapot',
    phaseLabel: 'Fázis',
    phaseValue: 'PHASE 02 – projektváz',
    noDataYet:
      'Az alkalmazás még nem tartalmaz és nem kér le pénzügyi adatot. A keresés, az elemzés és a portfólió a későbbi fázisokban készül el.',
    aboutButton: 'A projektről',
  },
  about: {
    title: 'A projektről',
    versionTitle: 'Verzió',
    appVersion: 'Alkalmazás',
    expoSdk: 'Expo SDK',
    configTitle: 'Konfiguráció (nyilvános értékek)',
    dataMode: 'Adatmód',
    dataModeMock: 'mock (demóadat)',
    dataModeLive: 'live (valós adat a proxyn át)',
    apiBaseUrl: 'Proxy URL',
    configIssuesTitle: 'Konfigurációs figyelmeztetések',
    configHint:
      'Ezek az EXPO_PUBLIC_* értékek bekerülnek az appba, ezért soha nem lehet köztük titkos kulcs.',
    principlesTitle: 'Alapelvek',
    principles: [
      'A számítás determinisztikus és ellenőrizhető; az AI csak magyaráz.',
      'A hiányzó adat nem nulla: N/A vagy hiányzó állapotként jelenik meg.',
      'Minden adat mellett látszik a forrás és a frissesség.',
    ],
  },
  notFound: {
    title: 'Nem található',
    message: 'Ez az oldal nem létezik.',
    backHome: 'Vissza a kezdőlapra',
  },
} as const;
