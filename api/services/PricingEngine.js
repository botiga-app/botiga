/**
 * PricingEngine — the ONLY place in the codebase where prices are calculated.
 * No other file may calculate or modify prices.
 *
 * The ladder is generated ONCE at negotiation start, stored in DB, never regenerated.
 */

class PricingEngine {
  constructor({ listPrice, floorPrice, maxDiscountPct }) {
    const discountFloor = listPrice * (1 - (maxDiscountPct || 20) / 100);
    this.listPrice = listPrice;
    this.floorPrice = Math.max(floorPrice || 0, discountFloor);
    this.priceLadder = this.generateLadder();
  }

  rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  generateLadder() {
    const floor = this.floorPrice;
    const list = this.listPrice;
    const spread = list - floor;

    // If spread is too small to negotiate, just offer floor immediately
    if (spread < 5) {
      return Array(6).fill(Math.round(floor));
    }

    // Step drops as DECREASING percentages of total spread.
    // Opening is a real gesture (28-38% of spread).
    // Each subsequent step is smaller — customer sees movement slowing.
    // No cliff at the end — step 5 lands naturally near floor+$2.
    const rawDrops = [
      spread * this.rand(0.28, 0.38), // Step 1: meaningful opening
      spread * this.rand(0.20, 0.28), // Step 2: real movement
      spread * this.rand(0.14, 0.20), // Step 3: slowing
      spread * this.rand(0.09, 0.14), // Step 4: getting tight
      spread * this.rand(0.05, 0.09), // Step 5: last real move
    ];

    const steps = [];
    let current = list;
    for (const drop of rawDrops) {
      current -= drop;
      steps.push(Math.round(current));
    }
    // Step 6 stops at floor + 1-3% of floor (obfuscates the true floor)
    // Customer never knows the real floor — bot just acts like it ran out of room
    const obfuscationPct = this.rand(0.01, 0.03);
    const obfuscatedFloor = Math.round(floor * (1 + obfuscationPct));
    steps.push(obfuscatedFloor);

    // ── SAFETY PASS ────────────────────────────────────────────────────────────
    // Enforce strict descent
    for (let i = 1; i < steps.length; i++) {
      if (steps[i] >= steps[i - 1]) steps[i] = steps[i - 1] - 1;
    }
    // Steps 1-4 must stay at least $4 above obfuscated floor
    for (let i = 0; i <= 3; i++) {
      if (steps[i] < obfuscatedFloor + 4) steps[i] = Math.round(obfuscatedFloor + 4);
    }
    // Step 5 must be at least obfuscated floor+$2 and below step 4
    if (steps[4] < obfuscatedFloor + 2) steps[4] = Math.round(obfuscatedFloor + 2);
    if (steps[4] >= steps[3]) steps[4] = steps[3] - 1;
    // Step 6 = obfuscated floor (1-3% above real floor) — final override
    steps[5] = obfuscatedFloor;

    return steps;
  }

  getPriceAtStep(stepIndex) {
    return this.priceLadder[Math.min(stepIndex, 5)];
  }
}

/**
 * Returns true if the customer's message is an acceptance of the bot's last offered price.
 * Called BEFORE LLM — never involves the LLM in deal detection.
 */
function isAcceptance(customerMessage, botLastPrice) {
  const msg = customerMessage.toLowerCase().trim();

  const acceptanceWords = [
    'ok', 'okay', 'yes', 'deal', 'sure', 'fine', 'done', 'accepted',
    'agreed', 'sold', "let's do it", "i'll take it", 'sounds good',
    'perfect', 'great', 'works for me', 'you got it', 'i accept',
    'yes please', 'go ahead', 'that works', "let's go", 'take it',
    "i'm in", 'im in', 'lets do it', 'yep', 'yup',
  ];

  const wordMatch = acceptanceWords.some(w => msg === w || msg.includes(w));
  const numericOffer = parseFloat(customerMessage.replace(/[^0-9.]/g, ''));
  const numericMatch = !isNaN(numericOffer) && numericOffer > 0 && numericOffer >= botLastPrice;

  return wordMatch || numericMatch;
}

/**
 * Random strategy for lowball (offer below floor).
 * 0 = hold firm
 * 1 = advance one step but signal pain
 * 2 = hold this + next message
 */
function lowballResponse() {
  return Math.floor(Math.random() * 3);
}

/**
 * Parse the highest numeric value from a customer message.
 */
function parseCustomerOffer(message) {
  if (!message) return null;
  const matches = message.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/g);
  if (!matches) return null;
  const prices = matches.map(p => parseFloat(p.replace(/[$,\s]/g, ''))).filter(p => p > 10);
  return prices.length > 0 ? Math.max(...prices) : null;
}

module.exports = { PricingEngine, isAcceptance, lowballResponse, parseCustomerOffer };
