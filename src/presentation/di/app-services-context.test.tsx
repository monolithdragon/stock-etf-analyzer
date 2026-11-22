import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { AppServices } from '@/application';

import { AppServicesProvider, useAppServices } from './app-services-context';

const fakeServices: AppServices = {
  getListingQuote: jest.fn(),
  getSecurityListings: jest.fn(),
  getFinancialStatements: jest.fn(),
  getPriceHistory: jest.fn(),
  getInstrumentProfile: jest.fn(),
  getDividendHistory: jest.fn(),
  searchInstruments: jest.fn(),
  convertMoney: jest.fn(),
  recordTransaction: jest.fn(),
  analyzeStockFundamentals: jest.fn(),
  analyzeStockValuation: jest.fn(),
  recalculateStockValuation: jest.fn(),
};

describe('useAppServices', () => {
  it('a Provider által adott szolgáltatásokat adja vissza', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppServicesProvider services={fakeServices}>{children}</AppServicesProvider>
    );
    const { result } = await renderHook(() => useAppServices(), { wrapper });
    expect(result.current).toBe(fakeServices);
  });

  it('Provider nélkül érthető hibával jelzi a hibás bekötést', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useAppServices())).rejects.toThrow('AppServicesProvider');
    jest.restoreAllMocks();
  });
});
