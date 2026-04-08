/**
 * PricingEngine — the ONLY place that decides what price the bot offers.
 * The LLM receives the output of this function and must use it exactly.
 * The LLM never decides prices.
 */

function round(n) {
  return Math.round(n * 100) / 100;
}

function computeNextBotPrice({ listPrice, floorPrice, botLastOffer, customerOffer, messageCount, maxMessages }) {
  // Message 0 — bot's first response. Always anchor at ~3% off list.
  // This is the opening anchor regardless of what customer said.
  if (messageCount === 0) {
    const anchor = round(Math.max(listPrice * 0.97, floorPrice));
    // If customer already meets or beats our anchor, close immediately
    if (customerOffer !== null && customerOffer >= anchor) {
      return { price: anchor, isDeal: true, isHold: false, isAnchor: false };
    }
    return { price: anchor, isDeal: false, isHold: false, isAnchor: true };
  }

  // Customer meets or beats bot's last offer → deal at bot's price
  if (customerOffer !== null && customerOffer >= botLastOffer) {
    return { price: botLastOffer, isDeal: true, isHold: false, isAnchor: false };
  }

  // No parseable offer, or customer below floor → hold position
  if (customerOffer === null || customerOffer < floorPrice) {
    return { price: botLastOffer, isDeal: false, isHold: true, isAnchor: false };
  }

  // Customer is between floor and bot's last offer — move toward them
  const gap = botLastOffer - customerOffer;
  const isLastMessage = messageCount >= maxMessages - 1;
  const isNearEnd = messageCount >= maxMessages - 2;

  let moveRatio;
  if (isLastMessage) moveRatio = 1.0;      // Final message: go to floor
  else if (isNearEnd) moveRatio = 0.50;    // Near end: bigger concession
  else moveRatio = 0.35;                   // Early: small, reluctant concession

  let nextPrice = botLastOffer - (gap * moveRatio);
  nextPrice = Math.max(nextPrice, floorPrice);

  // Last message always goes to floor — best and final
  if (isLastMessage) nextPrice = floorPrice;

  return { price: round(nextPrice), isDeal: false, isHold: false, isAnchor: false };
}

module.exports = { computeNextBotPrice };
