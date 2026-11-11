/**
 * GENERATED FILE — do not edit.
 *
 * Produced by `scripts/build-prices.mjs` from `data/cost-sheet.json`.
 * Change a cost there and run `npm run pricing:build`.
 *
 * Prices only: costs are deliberately absent from this file so they never
 * reach the browser bundle.
 */

export type GeneratedPrice = {
  /** Selling price in naira (cost + 30–50% markup, rounded to the step). */
  price: number;
  /** Largest discount percentage that still clears the 30% floor. */
  maxDiscountPercent: number;
};

export const CATALOG_PRICES: Record<string, GeneratedPrice> = {
  "proxy-eu-10": {
    "price": 28313,
    "maxDiscountPercent": 0
  },
  "proxy-ng-1": {
    "price": 3094,
    "maxDiscountPercent": 0
  },
  "proxy-ng-25": {
    "price": 57500,
    "maxDiscountPercent": 0
  },
  "proxy-ng-5": {
    "price": 13271,
    "maxDiscountPercent": 0
  },
  "proxy-us-5": {
    "price": 15479,
    "maxDiscountPercent": 0
  },
  "rent-ng-30": {
    "price": 6636,
    "maxDiscountPercent": 0
  },
  "rent-ng-7": {
    "price": 3358,
    "maxDiscountPercent": 0
  },
  "rent-ng-90": {
    "price": 17250,
    "maxDiscountPercent": 0
  },
  "rent-uk-30": {
    "price": 9292,
    "maxDiscountPercent": 0
  },
  "rent-us-30": {
    "price": 8407,
    "maxDiscountPercent": 0
  },
  "vn-ca": {
    "price": 1771,
    "maxDiscountPercent": 0
  },
  "vn-de": {
    "price": 1944,
    "maxDiscountPercent": 0
  },
  "vn-gh": {
    "price": 1242,
    "maxDiscountPercent": 0
  },
  "vn-ng": {
    "price": 1058,
    "maxDiscountPercent": 0
  },
  "vn-otp-5": {
    "price": 4865,
    "maxDiscountPercent": 0
  },
  "vn-uk": {
    "price": 1587,
    "maxDiscountPercent": 0
  },
  "vn-us": {
    "price": 1323,
    "maxDiscountPercent": 0
  }
};

export const DIGITAL_PRICES: Record<string, GeneratedPrice> = {
  "canva-1month": {
    "price": 2208,
    "maxDiscountPercent": 0
  },
  "canva-3months": {
    "price": 5750,
    "maxDiscountPercent": 0
  },
  "chatgpt-1month": {
    "price": 7073,
    "maxDiscountPercent": 0
  },
  "chatgpt-3months": {
    "price": 19458,
    "maxDiscountPercent": 0
  },
  "disney-1month": {
    "price": 2657,
    "maxDiscountPercent": 0
  },
  "disney-3months": {
    "price": 7073,
    "maxDiscountPercent": 0
  },
  "netflix-1month": {
    "price": 3094,
    "maxDiscountPercent": 0
  },
  "netflix-3months": {
    "price": 8407,
    "maxDiscountPercent": 0
  },
  "netflix-6months": {
    "price": 15479,
    "maxDiscountPercent": 0
  },
  "spotify-1month": {
    "price": 1771,
    "maxDiscountPercent": 0
  },
  "spotify-3months": {
    "price": 4865,
    "maxDiscountPercent": 0
  },
  "spotify-6months": {
    "price": 8844,
    "maxDiscountPercent": 0
  },
  "youtube-1month": {
    "price": 2208,
    "maxDiscountPercent": 0
  },
  "youtube-3months": {
    "price": 5750,
    "maxDiscountPercent": 0
  }
};
