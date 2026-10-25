export const CURRENCIES = [
  { code: 'USD', symbol: '$', label: 'USD ($)' },
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
  { code: 'CAD', symbol: 'C$', label: 'CAD (C$)' },
  { code: 'AUD', symbol: 'A$', label: 'AUD (A$)' },
  { code: 'JPY', symbol: '¥', label: 'JPY (¥)' },
  { code: 'CNY', symbol: '¥', label: 'CNY (人民币 ¥)' },
];

export const DEFAULT_CURRENCY = 'USD';

export const SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'C$',
  AUD: 'A$',
  JPY: '¥',
  CNY: '¥',
};

const RATES_KEY = 'bindarr_exchange_rates';
const RATE_MAX_AGE = 24 * 60 * 60 * 1000;

const readRates = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(RATES_KEY) || 'null');
    return saved?.base === 'USD' && saved?.rates ? saved : null;
  } catch {
    return null;
  }
};

// Refresh once a day, then keep working offline with the last successful rates.
// A failed refresh never discards an existing cache.
export const ensureExchangeRates = async ({ force = false } = {}) => {
  const cached = readRates();
  if (!force && cached && Date.now() - Number(cached.fetchedAt || 0) < RATE_MAX_AGE) return cached;
  try {
    const response = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,CAD,AUD,JPY,CNY');
    if (!response.ok) throw new Error(`exchange-rate HTTP ${response.status}`);
    const data = await response.json();
    const saved = { base: 'USD', date: data.date, fetchedAt: Date.now(), rates: { USD: 1, ...(data.rates || {}) } };
    localStorage.setItem(RATES_KEY, JSON.stringify(saved));
    window.dispatchEvent(new CustomEvent('bindarr_currency_change', { detail: getCurrency() }));
    return saved;
  } catch {
    return cached;
  }
};

export const getCurrency = () => {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('bindarr_currency') : null;
    return (stored && SYMBOLS[stored]) ? stored : DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
};

export const setCurrency = (code) => {
  const next = SYMBOLS[code] ? code : DEFAULT_CURRENCY;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('bindarr_currency', next);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bindarr_currency_change', { detail: next }));
  }
};

export const currencySymbol = (currency) => {
  const code = (currency && SYMBOLS[currency]) ? currency : getCurrency();
  return SYMBOLS[code] || '$';
};

export const activeCurrencySymbol = () => SYMBOLS[getCurrency()] || '$';

export const formatPrice = (p) => (parseFloat(p) || 0).toFixed(2);

export const convertPrice = (p, sourceCurrency = 'USD', targetCurrency = getCurrency()) => {
  const value = parseFloat(p) || 0;
  const source = SYMBOLS[sourceCurrency] ? sourceCurrency : 'USD';
  const target = SYMBOLS[targetCurrency] ? targetCurrency : DEFAULT_CURRENCY;
  if (source === target) return { value, currency: target, converted: false };
  const rates = readRates()?.rates;
  if (!rates?.[source] || !rates?.[target]) {
    // Never relabel an unconverted USD/EUR number as yuan. Until a first rate is
    // cached, showing the source currency is the only honest offline fallback.
    return { value, currency: source, converted: false };
  }
  return { value: (value / rates[source]) * rates[target], currency: target, converted: true };
};

export const priceText = (p, sourceCurrency = 'USD') => {
  const result = convertPrice(p, sourceCurrency);
  const digits = result.currency === 'JPY' ? 0 : 2;
  return `${currencySymbol(result.currency)}${result.value.toFixed(digits)}`;
};
