export const PREMIUM_BASE_PRICE = 1500;
export const PREMIUM_VAT_RATE = 7.5;
export const PREMIUM_VAT_PRICE = (PREMIUM_BASE_PRICE * PREMIUM_VAT_RATE) / 100;
export const PREMIUM_TOTAL_PRICE = PREMIUM_BASE_PRICE + PREMIUM_VAT_PRICE;
export const PROMO_BASE_PRICE = 1000;
export const PROMO_VAT_PRICE = (PROMO_BASE_PRICE * PREMIUM_VAT_RATE) / 100;
export const PROMO_TOTAL_PRICE = PROMO_BASE_PRICE + PROMO_VAT_PRICE;

/**
 * Formats an amount as naira with two decimals ("₦1,612.50"). Manual
 * grouping instead of toLocaleString so Hermes renders it identically
 * everywhere.
 */
export function naira(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const [whole, cents] = Math.abs(amount).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₦${grouped}.${cents}`;
}
