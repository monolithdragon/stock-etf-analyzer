import { parsePublicEnv } from './env';

describe('parsePublicEnv', () => {
  it('üres környezetben biztonságos alapértelmezést ad (mock, nincs URL, nincs hiba)', () => {
    expect(parsePublicEnv({})).toEqual({
      env: { dataMode: 'mock', apiBaseUrl: null },
      issues: [],
    });
  });

  it('az üres és csak szóközt tartalmazó értéket hiányzónak tekinti', () => {
    const result = parsePublicEnv({ EXPO_PUBLIC_DATA_MODE: '  ', EXPO_PUBLIC_API_BASE_URL: '' });
    expect(result.env).toEqual({ dataMode: 'mock', apiBaseUrl: null });
    expect(result.issues).toHaveLength(0);
  });

  it('érvényes live konfigurációt elfogad, a záró perjelet levágja', () => {
    const result = parsePublicEnv({
      EXPO_PUBLIC_DATA_MODE: 'LIVE',
      EXPO_PUBLIC_API_BASE_URL: ' https://proxy.example.com/api/ ',
    });
    expect(result.env).toEqual({ dataMode: 'live', apiBaseUrl: 'https://proxy.example.com/api' });
    expect(result.issues).toHaveLength(0);
  });

  it('elfogad helyi hálózati címet porttal', () => {
    const result = parsePublicEnv({ EXPO_PUBLIC_API_BASE_URL: 'http://192.168.0.10:8081' });
    expect(result.env.apiBaseUrl).toBe('http://192.168.0.10:8081');
  });

  it('ismeretlen adatmódnál mock marad, és hibát jelez (nem csendes)', () => {
    const result = parsePublicEnv({ EXPO_PUBLIC_DATA_MODE: 'production' });
    expect(result.env.dataMode).toBe('mock');
    expect(result.issues).toEqual([expect.objectContaining({ variable: 'EXPO_PUBLIC_DATA_MODE' })]);
  });

  it('érvénytelen URL-t nem fogad el', () => {
    for (const bad of ['proxy.example.com', 'ftp://example.com', 'http://', 'http://a b']) {
      const result = parsePublicEnv({ EXPO_PUBLIC_API_BASE_URL: bad });
      expect(result.env.apiBaseUrl).toBeNull();
      expect(result.issues).toEqual([
        expect.objectContaining({ variable: 'EXPO_PUBLIC_API_BASE_URL' }),
      ]);
    }
  });

  it('live módban hiányzó URL esetén hibát jelez', () => {
    const result = parsePublicEnv({ EXPO_PUBLIC_DATA_MODE: 'live' });
    expect(result.env).toEqual({ dataMode: 'live', apiBaseUrl: null });
    expect(result.issues).toEqual([
      expect.objectContaining({ variable: 'EXPO_PUBLIC_API_BASE_URL' }),
    ]);
  });
});
