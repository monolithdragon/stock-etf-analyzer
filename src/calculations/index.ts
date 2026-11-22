/**
 * Pénzügyi számítási motor – nyilvános felület (PHASE 05, ARCHITECTURE 3.).
 *
 * Tiszta TypeScript: csak a `@/domain`-t importálhatja; React, React Native, Expo, hálózat
 * (`fetch`) és más réteg tilos (ESLint kikényszeríti). Nincs I/O, nincs óra, nincs véletlen:
 * ugyanarra a bemenetre mindig ugyanaz a kimenet.
 */
export * from './core/calc-result';
export * from './core/numeric';
export * from './core/to-metric';
export * from './definitions';
export * from './fundamentals/profitability';
export * from './fundamentals/growth';
export * from './fundamentals/balance-cashflow';
export * from './valuation/multiples';
export * from './valuation/dcf-conventions';
export * from './returns/returns';
export * from './returns/drawdown';
export * from './returns/future-value';
export * from './etf/costs-tracking';
export * from './portfolio/portfolio-basics';
