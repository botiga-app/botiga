export function renderDealBanner({ shadow, dealPrice, listPrice, checkoutUrl, expiresAt }) {
  // Remove input row, replace with deal banner
  const inputRow = shadow.querySelector('.botiga-input-row');
  if (inputRow) inputRow.remove();

  const banner = document.createElement('div');
  banner.id = 'botiga-deal-banner';

  const expiryDate = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 2 * 60 * 60 * 1000);

  banner.innerHTML = `
    <div class="botiga-deal-banner-title">🎉 Deal locked in!</div>
    <div>
      <span class="botiga-deal-price">$${parseFloat(dealPrice).toFixed(2)}</span>
      <span class="botiga-deal-original">$${parseFloat(listPrice).toFixed(2)}</span>
    </div>
    <div class="botiga-deal-timer" id="botiga-countdown">Expires in: calculating...</div>
    <a href="${checkoutUrl}" class="botiga-checkout-btn" target="_top">
      Complete Purchase →
    </a>
  `;

  const panel = shadow.querySelector('#botiga-chat-panel');
  if (panel) panel.appendChild(banner);

  // Countdown timer
  const countdownEl = shadow.querySelector('#botiga-countdown');
  const tick = () => {
    const remaining = expiryDate - Date.now();
    if (remaining <= 0) {
      countdownEl.textContent = 'Deal expired';
      return;
    }
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    countdownEl.textContent = `Expires in: ${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
    setTimeout(tick, 1000);
  };
  tick();
}
