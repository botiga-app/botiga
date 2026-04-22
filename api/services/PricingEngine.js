/**
 * PricingEngine — the ONLY place in the codebase where prices are calculated.
 * No other file may calculate or modify prices.
 *
 * The ladder is generated ONCE at negotiation start, stored in DB, never regenerated.
 */

// Minimum dollar spread by price tier — guarantees a real negotiation at any price point.
// A $38 item with 20% max gives only $7.60 spread; that's not worth negotiating.
// These floors ensure the ladder has meaningful steps regardless of the percentage setting.
function minNegotiableSpread(listPrice) {
  if (listPrice < 30)  return 8;
  if (listPrice < 60)  return 14;
  if (listPrice < 100) return 22;
  if (listPrice < 200) return 35;
  if (listPrice < 400) return 55;
  return listPrice * 0.20;
}

class PricingEngine {
  constructor({ listPrice, floorPrice, maxDiscountPct }) {
    // Percentage-based floor from merchant setting
    const pctFloor = listPrice * (1 - (maxDiscountPct || 20) / 100);
    // Dollar-spread floor — ensures enough room for a real ladder
    const spreadFloor = listPrice - minNegotiableSpread(listPrice);
    // Use whichever gives MORE room (lower floor), but never below a merchant's fixed floor
    const discountFloor = Math.min(pctFloor, spreadFloor);
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

    // Obfuscated floor: 1-3% above real floor so customer can't reverse-engineer it
    const obfuscationPct = this.rand(0.01, 0.03);
    const obfuscatedFloor = Math.round(floor * (1 + obfuscationPct));
    const usableSpread = list - obfuscatedFloor;

    // Minimum meaningful drop per step — at least 2% of list price or $2, whichever is larger
    const minDrop = Math.max(2, Math.round(list * 0.02));

    // If spread can't support 6 meaningful steps, use fewer
    const maxSteps = Math.min(6, Math.floor(usableSpread / minDrop));
    if (maxSteps < 2) {
      // Spread too small for multiple steps — single opening offer at obfuscated floor
      // (bot opens at best price immediately, still a real negotiation for acceptance)
      return [obfuscatedFloor, obfuscatedFloor, obfuscatedFloor, obfuscatedFloor, obfuscatedFloor, obfuscatedFloor];
    }

    // Distribute drops as decreasing percentages — opening is the biggest gesture
    const dropWeights = [0.35, 0.25, 0.18, 0.12, 0.07, 0.03].slice(0, maxSteps - 1);
    const weightSum = dropWeights.reduce((a, b) => a + b, 0);
    // Reserve last step for obfuscated floor, distribute rest across earlier steps
    const remainingSpread = usableSpread - minDrop; // keep minDrop for last step

    const steps = [];
    let current = list;
    for (let i = 0; i < dropWeights.length; i++) {
      const nominalDrop = (dropWeights[i] / weightSum) * remainingSpread;
      // Add ±10% jitter so prices don't look algorithmic
      const jitter = this.rand(0.9, 1.1);
      const drop = Math.max(minDrop, Math.round(nominalDrop * jitter));
      current -= drop;
      steps.push(Math.round(current));
    }

    // Final step — obfuscated floor
    steps.push(obfuscatedFloor);

    // Pad to 6 steps if fewer were generated (repeat last meaningful step)
    while (steps.length < 6) {
      steps.push(obfuscatedFloor);
    }

    // ── SAFETY PASS — strict descent, min drop enforced ───────────────────────
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1];
      // Each step must be at least minDrop below the previous, except the last
      const requiredDrop = i < steps.length - 1 ? minDrop : 1;
      if (steps[i] > prev - requiredDrop) {
        steps[i] = prev - requiredDrop;
      }
      // Never go below obfuscated floor
      if (steps[i] < obfuscatedFloor) steps[i] = obfuscatedFloor;
    }

    // Last step always obfuscated floor
    steps[steps.length - 1] = obfuscatedFloor;

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

  // Accept if offer >= bot price, OR if within 3% (don't give away more for a $1 gap)
  const closeEnough = botLastPrice * 0.97;
  const numericMatch = !isNaN(numericOffer) && numericOffer > 0 && numericOffer >= closeEnough;

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
