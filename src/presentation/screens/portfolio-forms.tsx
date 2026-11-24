/**
 * Portfólió-űrlapok (PHASE 12): létrehozás és tranzakció rögzítése.
 *
 * Validáció: a domain/use case végzi (`createPortfolio`, `recordTransaction`); az űrlap a
 * `VALIDATION` hiba mezőútvonalait a mezők alá írja. A számmezők tizedesvesszőt is elfogadnak.
 */
import { useState } from 'react';
import { View } from 'react-native';

import type { AppError } from '@/domain';
import { parseCurrencyCode, parseListingId, toLocalIsoDate } from '@/domain';
import {
  AppText,
  ChoiceGroup,
  ErrorState,
  PrimaryButton,
  TextField,
} from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { BASE_CURRENCIES, type BaseCurrency } from '@/presentation/state/settings-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';

/** `"1 234,5"` → `1234.5`; üres vagy hibás → `NaN` (a domain validáció utasítja el, okkal). */
export function parseDecimalInput(raw: string): number {
  const normalized = raw.replace(/[\s ]/g, '').replace(',', '.');
  if (normalized === '' || !/^-?\d*\.?\d+$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

/** VALIDATION hiba → mezőnkénti üzenetek (az útvonal első szegmense a mező). */
export function fieldErrors(error: AppError | null): Readonly<Record<string, string>> {
  if (error === null || error.kind !== 'VALIDATION') return {};
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.split('.')[0] ?? '';
    if (field !== '' && out[field] === undefined) out[field] = issue.message;
  }
  return out;
}

export function CreatePortfolioForm({
  portfolioId,
  defaultCurrency,
  onCreated,
}: {
  readonly portfolioId: string;
  readonly defaultCurrency: BaseCurrency;
  readonly onCreated: () => void;
}) {
  const theme = useTheme();
  const services = useAppServices();
  const [name, setName] = useState<string>(strings.portfolio.defaultName);
  const [currency, setCurrency] = useState<BaseCurrency>(defaultCurrency);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    services
      .createPortfolio({ id: portfolioId, name, baseCurrency: currency })
      .then((result) => {
        setBusy(false);
        if (result.ok) onCreated();
        else setError(result.error);
      })
      .catch(() => setBusy(false));
  };
  const errors = fieldErrors(error);

  return (
    <View style={{ gap: theme.spacing.md }} testID="create-portfolio-form">
      <TextField
        label={strings.portfolio.nameLabel}
        value={name}
        onChangeText={setName}
        error={errors.name}
      />
      <AppText variant="caption" tone="textSecondary">
        {strings.portfolio.baseCurrencyLabel}
      </AppText>
      <ChoiceGroup
        label={strings.portfolio.baseCurrencyLabel}
        options={BASE_CURRENCIES.map((c) => ({ value: c, label: c }))}
        value={currency}
        onChange={setCurrency}
      />
      <AppText variant="caption" tone="textSecondary">
        {strings.portfolio.baseCurrencyHint}
      </AppText>
      {error !== null && errors.name === undefined && <ErrorState error={error} />}
      <PrimaryButton label={strings.portfolio.create} onPress={submit} disabled={busy} />
    </View>
  );
}

type TradeType = 'BUY' | 'SELL';

export function AddTransactionForm({
  portfolioId,
  onRecorded,
}: {
  readonly portfolioId: string;
  readonly onRecorded: () => void;
}) {
  const theme = useTheme();
  const services = useAppServices();
  const [listingId, setListingId] = useState('');
  const [type, setType] = useState<TradeType>('BUY');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [fees, setFees] = useState('0');
  const [tradeDate, setTradeDate] = useState<string>(() => toLocalIsoDate(new Date()));
  const [error, setError] = useState<AppError | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setSaved(false);
    setError(null);
    const listing = parseListingId(listingId);
    const ccy = parseCurrencyCode(currency);
    const local: Record<string, string> = {};
    if (!listing.ok) local.listingId = listing.error.message;
    if (!ccy.ok) local.priceCurrency = ccy.error.message;
    setLocalErrors(local);
    if (!listing.ok || !ccy.ok) return;

    setBusy(true);
    services
      .recordTransaction({
        portfolioId,
        listingId: listing.value,
        type,
        quantity: parseDecimalInput(quantity),
        price: parseDecimalInput(price),
        priceCurrency: ccy.value,
        fees: parseDecimalInput(fees),
        feesCurrency: ccy.value,
        tradeDate,
      })
      .then((result) => {
        setBusy(false);
        if (result.ok) {
          setSaved(true);
          setQuantity('');
          setPrice('');
          onRecorded();
        } else {
          setError(result.error);
        }
      })
      .catch(() => setBusy(false));
  };

  const errors = { ...fieldErrors(error), ...localErrors };
  const fieldKeys = ['listingId', 'quantity', 'price', 'priceCurrency', 'fees', 'tradeDate'];
  const hasUnmappedError = error !== null && !fieldKeys.some((k) => errors[k] !== undefined);

  return (
    <View style={{ gap: theme.spacing.md }} testID="add-transaction-form">
      <TextField
        label={strings.portfolio.listingIdLabel}
        placeholder="DEMO@XNAS"
        autoCapitalize="characters"
        autoCorrect={false}
        value={listingId}
        onChangeText={setListingId}
        error={errors.listingId}
      />
      <ChoiceGroup
        label={strings.portfolio.typeLabel}
        options={[
          { value: 'BUY', label: strings.portfolio.buy },
          { value: 'SELL', label: strings.portfolio.sell },
        ]}
        value={type}
        onChange={setType}
      />
      <TextField
        label={strings.portfolio.quantityLabel}
        keyboardType="decimal-pad"
        value={quantity}
        onChangeText={setQuantity}
        error={errors.quantity}
      />
      <TextField
        label={strings.portfolio.priceLabel}
        keyboardType="decimal-pad"
        value={price}
        onChangeText={setPrice}
        error={errors.price}
      />
      <TextField
        label={strings.portfolio.currencyLabel}
        autoCapitalize="characters"
        value={currency}
        onChangeText={setCurrency}
        error={errors.priceCurrency}
      />
      <TextField
        label={strings.portfolio.feesLabel}
        keyboardType="decimal-pad"
        value={fees}
        onChangeText={setFees}
        error={errors.fees}
      />
      <TextField
        label={strings.portfolio.dateLabel}
        value={tradeDate}
        onChangeText={setTradeDate}
        error={errors.tradeDate}
      />
      {hasUnmappedError && error !== null && <ErrorState error={error} />}
      {saved && (
        <AppText tone="positive" accessibilityLiveRegion="polite">
          {`✓ ${strings.portfolio.saved}`}
        </AppText>
      )}
      <PrimaryButton label={strings.portfolio.record} onPress={submit} disabled={busy} />
    </View>
  );
}
