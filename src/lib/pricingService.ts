import { PricingSettings } from '../types';

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  id: 'global-pricing',
  expressSurchargeType: 'percentage',
  expressSurchargeValue: 15, // 15% premium by default
  vatRate: 15,
  currency: 'ZAR',
  // NCR Defaults
  ncrBaseRate: 45.00,
  ncrSizeFactors: {
    'A4': 1.0,
    'A5': 0.6,
    'A6': 0.4,
    'DL': 0.35,
  },
  ncrPartFactors: {
    '2-part': 1.0,
    '3-part': 1.5,
    '4-part': 2.0,
  },
  ncrPrintFactors: {
    'Greyscale': 1.0,
    'Full Colour': 1.6,
  },
  ncrBindingRates: {
    'Glued': 15.00,
    'Stapled & Tabbed': 25.00,
  },
  ncrVolumeDiscounts: [
    { minQty: 200, discount: 0.45 },
    { minQty: 100, discount: 0.35 },
    { minQty: 50, discount: 0.25 },
    { minQty: 20, discount: 0.15 },
    { minQty: 10, discount: 0.08 },
  ],
  ncrSets100Factor: 1.8,
  ncrNumberingFee: 8.50,
  ncrPerforationFee: 4.00,
  ncrCoverFee: 12.00,
};

const round = (num: number) => Math.round(num * 100) / 100;

export const calculateQuoteTotals = (
  items: { totalPrice: number; totalCost: number }[],
  isExpress: boolean,
  settings: PricingSettings
) => {
  const subtotal = round(
    items.reduce((sum, item) => sum + Number(item.totalPrice), 0)
  );

  const totalCost = round(
    items.reduce((sum, item) => sum + Number(item.totalCost), 0)
  );

  let expressSurcharge = 0;

  if (isExpress) {
    if (settings.expressSurchargeType === 'percentage') {
      expressSurcharge = round(subtotal * (settings.expressSurchargeValue / 100));
    } else {
      expressSurcharge = round(settings.expressSurchargeValue);
    }
  }

  const taxableAmount = round(subtotal + expressSurcharge);

  // ✅ VAT (EXCLUSIVE pricing)
  const vat = round(taxableAmount * (settings.vatRate / 100));

  const total = round(taxableAmount + vat);

  const profit = round(taxableAmount - totalCost);

  return {
    subtotal,
    expressSurcharge,
    vat,
    total,
    profit
  };
};