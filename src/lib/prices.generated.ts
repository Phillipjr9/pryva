/**
 * GENERATED FILE — do not edit.
 *
 * Produced by `scripts/build-prices.mjs` from `data/supplier-costs.json`.
 * Change a supplier cost there and run `npm run pricing:build`.
 *
 * Prices only: supplier costs are deliberately absent from this file so they
 * never reach the browser bundle.
 */

export type GeneratedPrice = {
  /** Selling price in naira (cost + 30–50% markup, rounded to the step). */
  price: number;
  /** Largest discount percentage that still clears the 30% floor. */
  maxDiscountPercent: number;
};

export const CATALOG_PRICES: Record<string, GeneratedPrice> = {
  "email-24": {
    "price": 790,
    "maxDiscountPercent": 6
  },
  "email-30": {
    "price": 6150,
    "maxDiscountPercent": 10
  },
  "email-bundle": {
    "price": 2010,
    "maxDiscountPercent": 10
  },
  "email-team": {
    "price": 13950,
    "maxDiscountPercent": 10
  },
  "esim-africa": {
    "price": 12500,
    "maxDiscountPercent": 4
  },
  "esim-europe": {
    "price": 19250,
    "maxDiscountPercent": 3
  },
  "esim-global": {
    "price": 49850,
    "maxDiscountPercent": 3
  },
  "esim-ng-1": {
    "price": 4700,
    "maxDiscountPercent": 4
  },
  "esim-ng-5": {
    "price": 15100,
    "maxDiscountPercent": 4
  },
  "esim-us": {
    "price": 24950,
    "maxDiscountPercent": 3
  },
  "proxy-eu-10": {
    "price": 33250,
    "maxDiscountPercent": 3
  },
  "proxy-ng-1": {
    "price": 3650,
    "maxDiscountPercent": 4
  },
  "proxy-ng-25": {
    "price": 67500,
    "maxDiscountPercent": 3
  },
  "proxy-ng-5": {
    "price": 15600,
    "maxDiscountPercent": 3
  },
  "proxy-us-5": {
    "price": 18200,
    "maxDiscountPercent": 3
  },
  "rent-ng-30": {
    "price": 8400,
    "maxDiscountPercent": 10
  },
  "rent-ng-7": {
    "price": 4250,
    "maxDiscountPercent": 10
  },
  "rent-ng-90": {
    "price": 21750,
    "maxDiscountPercent": 10
  },
  "rent-uk-30": {
    "price": 11750,
    "maxDiscountPercent": 10
  },
  "rent-us-30": {
    "price": 10600,
    "maxDiscountPercent": 10
  },
  "vn-ca": {
    "price": 2240,
    "maxDiscountPercent": 10
  },
  "vn-de": {
    "price": 2460,
    "maxDiscountPercent": 10
  },
  "vn-gh": {
    "price": 1570,
    "maxDiscountPercent": 10
  },
  "vn-ng": {
    "price": 1340,
    "maxDiscountPercent": 10
  },
  "vn-otp-5": {
    "price": 6150,
    "maxDiscountPercent": 10
  },
  "vn-uk": {
    "price": 2010,
    "maxDiscountPercent": 10
  },
  "vn-us": {
    "price": 1670,
    "maxDiscountPercent": 10
  }
};

export const DIGITAL_PRICES: Record<string, GeneratedPrice> = {
  "canva-1month": {
    "price": 2690,
    "maxDiscountPercent": 7
  },
  "canva-3months": {
    "price": 7000,
    "maxDiscountPercent": 7
  },
  "chatgpt-1month": {
    "price": 8650,
    "maxDiscountPercent": 7
  },
  "chatgpt-3months": {
    "price": 23700,
    "maxDiscountPercent": 7
  },
  "disney-1month": {
    "price": 3250,
    "maxDiscountPercent": 7
  },
  "disney-3months": {
    "price": 8650,
    "maxDiscountPercent": 7
  },
  "netflix-1month": {
    "price": 3800,
    "maxDiscountPercent": 7
  },
  "netflix-3months": {
    "price": 10250,
    "maxDiscountPercent": 7
  },
  "netflix-6months": {
    "price": 18850,
    "maxDiscountPercent": 7
  },
  "spotify-1month": {
    "price": 2160,
    "maxDiscountPercent": 7
  },
  "spotify-3months": {
    "price": 5950,
    "maxDiscountPercent": 7
  },
  "spotify-6months": {
    "price": 10800,
    "maxDiscountPercent": 7
  },
  "youtube-1month": {
    "price": 2690,
    "maxDiscountPercent": 7
  },
  "youtube-3months": {
    "price": 7000,
    "maxDiscountPercent": 7
  }
};
