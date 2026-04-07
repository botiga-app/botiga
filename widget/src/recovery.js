const API_BASE = 'https://api.botiga.ai';

export function setupExitIntent(settings, getCurrentNegotiationId) {
  let triggered = false;

  document.addEventListener('mouseleave', (e) => {
    if (e.clientY <= 0 && !triggered) {
      const negotiationId = getCurrentNegotiationId();
      if (negotiationId) {
        triggered = true;
        showExitIntentPopup(settings, negotiationId);
      }
    }
  });
}

function showExitIntentPopup(settings, negotiationId) {
  const existing = document.getElementById('botiga-exit-overlay');
  if (existing) return;

  const overlay = document.createElement('div');
  overlay.id = 'botiga-exit-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    z-index: 2147483647; display: flex; align-items: center; justify-content: center;
  `;

  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });

  // Inline minimal styles for the popup
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .popup {
      background: #fff; border-radius: 16px; padding: 28px; width: 340px;
      font-family: system-ui, sans-serif;
    }
    h3 { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
    p { font-size: 13px; color: #666; margin-bottom: 16px; }
    input {
      width: 100%; border: 1.5px solid #ddd; border-radius: 8px;
      padding: 10px 14px; font-size: 13px; margin-bottom: 10px;
      font-family: inherit; outline: none; display: block;
    }
    button.primary {
      width: 100%; padding: 12px; background: #1a1a2e; color: #fff;
      border: none; border-radius: 8px; font-size: 14px; font-weight: 600;
      cursor: pointer;
    }
    button.skip {
      display: block; width: 100%; text-align: center; margin-top: 10px;
      font-size: 12px; color: #999; cursor: pointer; background: none;
      border: none; font-family: inherit;
    }
    .success { font-size: 14px; color: #047857; text-align: center; padding: 10px 0; }
  `;

  const popup = document.createElement('div');
  popup.className = 'popup';
  popup.innerHTML = `
    <h3>Wait — hold your deal! 🤝</h3>
    <p>Leave your number and we'll send you the deal so you can come back later.</p>
    <input type="tel" id="botiga-exit-phone" placeholder="WhatsApp number (e.g. +1234567890)" />
    <input type="email" id="botiga-exit-email" placeholder="Or your email" />
    <button class="primary" id="botiga-exit-submit">Save my deal</button>
    <button class="skip" id="botiga-exit-skip">No thanks</button>
  `;

  shadow.appendChild(style);
  shadow.appendChild(popup);
  overlay.appendChild(host);
  document.body.appendChild(overlay);

  const dismiss = () => {
    overlay.remove();
  };

  shadow.querySelector('#botiga-exit-skip').addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });

  shadow.querySelector('#botiga-exit-submit').addEventListener('click', async () => {
    const phone = shadow.querySelector('#botiga-exit-phone').value.trim();
    const email = shadow.querySelector('#botiga-exit-email').value.trim();

    if (!phone && !email) {
      shadow.querySelector('#botiga-exit-phone').style.borderColor = '#ef4444';
      return;
    }

    try {
      await fetch(`${API_BASE}/api/recovery/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          negotiation_id: negotiationId,
          customer_whatsapp: phone || null,
          customer_email: email || null
        })
      });

      popup.innerHTML = '<p class="success">✅ Deal saved! We\'ll send it to you.</p>';
      setTimeout(dismiss, 2000);
    } catch {
      dismiss();
    }
  });
}
