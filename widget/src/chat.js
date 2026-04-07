import { renderDealBanner } from './deal.js';

const API_BASE = 'https://api.botiga.ai';

export function createChatWidget({ settings, buttonStyles, apiKey, productInfo, shadow }) {
  let negotiationId = null;
  let isLoading = false;

  const overlay = document.createElement('div');
  overlay.id = 'botiga-chat-overlay';

  const panel = document.createElement('div');
  panel.id = 'botiga-chat-panel';

  panel.innerHTML = `
    <div class="botiga-chat-header">
      <div>
        <h3>💬 Make an offer</h3>
        <p>${productInfo.name || 'Chat with us'}</p>
      </div>
      <button class="botiga-close-btn" id="botiga-close">✕</button>
    </div>
    <div class="botiga-messages" id="botiga-messages">
      <div class="botiga-msg bot">
        Hey! I see you're interested in <strong>${productInfo.name || 'this item'}</strong>${productInfo.price ? ` (listed at <strong>$${productInfo.price}</strong>)` : ''}. What offer did you have in mind? 😊
      </div>
    </div>
    <div class="botiga-input-row">
      <input
        class="botiga-input"
        id="botiga-input"
        type="text"
        placeholder="Type your offer..."
        autocomplete="off"
      />
      <button class="botiga-send-btn" id="botiga-send" aria-label="Send">➤</button>
    </div>
  `;

  overlay.appendChild(panel);
  shadow.appendChild(overlay);

  const messagesEl = shadow.querySelector('#botiga-messages');
  const inputEl = shadow.querySelector('#botiga-input');
  const sendBtn = shadow.querySelector('#botiga-send');

  // Close
  shadow.querySelector('#botiga-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Send on Enter
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  sendBtn.addEventListener('click', sendMessage);

  // Auto-focus
  setTimeout(() => inputEl.focus(), 100);

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;

    inputEl.value = '';
    appendMessage('user', text);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/negotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          session_id: getSessionId(),
          negotiation_id: negotiationId,
          product_name: productInfo.name,
          product_url: productInfo.url,
          list_price: productInfo.price || 0,
          customer_message: text
        })
      });

      const data = await res.json();

      if (data.error) {
        appendMessage('bot', "Sorry, I'm having trouble right now. Please try again.");
        return;
      }

      negotiationId = data.negotiation_id;
      appendMessage('bot', data.bot_reply);

      if (data.status === 'won' && data.deal_price) {
        renderDealBanner({
          shadow,
          dealPrice: data.deal_price,
          listPrice: productInfo.price || data.deal_price,
          checkoutUrl: data.checkout_url,
          expiresAt: data.expires_at
        });
      }
    } catch {
      appendMessage('bot', "Connection issue — please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  function appendMessage(role, text) {
    // Remove typing indicator if present
    const typing = shadow.querySelector('.botiga-typing');
    if (typing) typing.remove();

    const msg = document.createElement('div');
    msg.className = `botiga-msg ${role}`;
    msg.textContent = text;
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setLoading(state) {
    isLoading = state;
    sendBtn.disabled = state;
    if (state) {
      const typing = document.createElement('div');
      typing.className = 'botiga-typing';
      typing.textContent = 'typing...';
      messagesEl.appendChild(typing);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  return {
    overlay,
    getNegotiationId: () => negotiationId
  };
}

function getSessionId() {
  const key = '_botiga_sid';
  let sid = sessionStorage.getItem(key);
  if (!sid) {
    // Simple fingerprint: randomness + screen + UA hash
    sid = btoa([
      Math.random().toString(36).slice(2),
      screen.width,
      screen.height,
      navigator.userAgent.length
    ].join('|')).replace(/=/g, '');
    sessionStorage.setItem(key, sid);
  }
  return sid;
}
