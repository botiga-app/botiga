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
    const spread = this.listPrice - this.floorPrice;
    const steps = [];
    let current = this.listPrice;

    // Step 1 — small goodwill opening
    current = current - (spread * this.rand(0.05, 0.12));
    steps.push(Math.round(current));

    // Step 2 — real movement, customer pushed
    current = current - (spread * this.rand(0.10, 0.20));
    steps.push(Math.round(current));

    // Step 3 — slowing down
    current = current - (spread * this.rand(0.10, 0.18));
    steps.push(Math.round(current));

    // Step 4 — getting tight
    current = current - (spread * this.rand(0.08, 0.15));
    steps.push(Math.round(current));

    // Step 5 — near final, at least $2 above floor
    current = current - (spread * this.rand(0.05, 0.10));
    steps.push(Math.round(current));

    // Step 6 — always exactly floor, no randomness
    steps.push(Math.round(this.floorPrice));

    // Safety pass — enforce strict descent and floor constraints
    for (let i = 1; i < steps.length; i++) {
      if (steps[i] >= steps[i - 1]) {
        steps[i] = steps[i - 1] - 1;
      }
      if (i < 5 && steps[i] < this.floorPrice + 2) {
        steps[i] = this.floorPrice + 2;
      }
    }
    // Step 4 (index 4) must be >= floor + $2
    if (steps[4] < this.floorPrice + 2) {
      steps[4] = this.floorPrice + 2;
    }
    // Step 6 (index 5) is always exactly floor — override everything
    steps[5] = Math.round(this.floorPrice);

    return steps;
  }

  getPriceAtStep(stepIndex) {
    return this.priceLadder[Math.min(stepIndex, 5)];
  }
}

/**
 * Returns true if the customer's message is an acceptance of the bot's last offered price.
 * Called before LLM — never involves the LLM in deal detection.
 */
function isAcceptance(customerMessage, botLastPrice) {
  const msg = customerMessage.toLowerCase().trim();

  const acceptanceWords = [
    'ok', 'okay', 'yes', 'deal', 'sure', 'fine', 'done', 'accepted',
    'agreed', 'sold', "let's do it", "i'll take it", 'sounds good',
    'perfect', 'great', 'works for me', 'you got it', 'i accept',
    'yes please', 'go ahead', 'that works', "let's go", 'take it',
    "i'm in", 'im in', 'absolutely', 'lets do it', "i'll take it"
  ];

  const wordMatch = acceptanceWords.some(w => msg === w || msg.includes(w));

  const numericOffer = parseFloat(customerMessage.replace(/[^0-9.]/g, ''));
  const numericMatch = !isNaN(numericOffer) && numericOffer >= botLastPrice;

  return wordMatch || numericMatch;
}

/**
 * Returns a random strategy for handling a lowball offer.
 * 0 = hold firm at current price
 * 1 = move one step but signal pain
 * 2 = hold for this message AND next message
 */
function lowballResponse() {
  return Math.floor(Math.random() * 3);
}

/**
 * Parse the highest numeric value from a customer message.
 * Returns null if no number found or all numbers <= 10.
 */
function parseCustomerOffer(message) {
  if (!message) return null;
  const matches = message.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/g);
  if (!matches) return null;
  const prices = matches.map(p => parseFloat(p.replace(/[$,\s]/g, ''))).filter(p => p > 10);
  return prices.length > 0 ? Math.max(...prices) : null;
}

module.exports = { PricingEngine, isAcceptance, lowballResponse, parseCustomerOffer };
