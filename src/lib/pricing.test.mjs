import assert from "node:assert/strict";
import test from "node:test";

import {
  PREMIUM_BASE_PRICE,
  PREMIUM_TOTAL_PRICE,
  PREMIUM_VAT_PRICE,
  PROMO_BASE_PRICE,
  PROMO_TOTAL_PRICE,
  PROMO_VAT_PRICE,
  naira,
} from "./pricing.ts";

test("VAT splits out of the base price exactly", () => {
  assert.equal(PREMIUM_BASE_PRICE, 1500);
  assert.equal(PREMIUM_VAT_PRICE, 112.5);
  assert.equal(PREMIUM_TOTAL_PRICE, 1612.5);
});

test("the first-month promo carries VAT too", () => {
  assert.equal(PROMO_BASE_PRICE, 1000);
  assert.equal(PROMO_VAT_PRICE, 75);
  assert.equal(PROMO_TOTAL_PRICE, 1075);
});

test("naira formats with grouping and two decimals", () => {
  assert.equal(naira(1500), "₦1,500.00");
  assert.equal(naira(112.5), "₦112.50");
  assert.equal(naira(1612.5), "₦1,612.50");
  assert.equal(naira(1075), "₦1,075.00");
  assert.equal(naira(1000), "₦1,000.00");
  assert.equal(naira(0), "₦0.00");
  assert.equal(naira(1234567.891), "₦1,234,567.89");
  assert.equal(naira(-5), "-₦5.00");
});
