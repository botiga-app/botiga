(function () {
  'use strict';

  const script = document.currentScript ||
    document.querySelector('script[src*="/n.js"]') ||
    document.querySelector('script[data-api]');
  if (!script) return;

  const API_BASE = (script.dataset.api || 'https://api.botiga.ai').replace(/\/$/, '');
  const apiKey = (script.src ? new URL(script.src).searchParams.get('k') : null) || script.dataset.k;
  if (!apiKey) return;

  const overrideColor = script.dataset.color || null;
  const overrideLabel = script.dataset.label || null;
  const overridePosition = script.dataset.position || null;

  const API_HEADERS = { 'ngrok-skip-browser-warning': '1' };

  // ── SESSION ──────────────────────────────────────────────────────────────────
  // Clear stale session state on every page load
  const SESSION_KEY = '_botiga_session';
  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return {};
      const s = JSON.parse(raw);
      // Expire sessions older than 2 hours
      if (s.ts && Date.now() - s.ts > 2 * 60 * 60 * 1000) {
        sessionStorage.removeItem(SESSION_KEY);
        return {};
      }
      return s;
    } catch { return {}; }
  }
  function saveSession(patch) {
    const current = getSession();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...current, ...patch, ts: Date.now() }));
  }
  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function getSessionId() {
    let s = getSession();
    if (!s.sid) {
      s.sid = btoa([Math.random().toString(36).slice(2), screen.width, screen.height, navigator.userAgent.length].join('|')).replace(/=/g, '');
      saveSession({ sid: s.sid });
    }
    return s.sid;
  }

  // ── PRODUCT & STYLE DETECTION ────────────────────────────────────────────────
  function detectStyles() {
    const selectors = ['[data-add-to-cart]', '.btn-cart', '#add-to-cart', '[name="add"]',
      '.product-form__cart-submit', '.product-form__submit', 'button[type="submit"].btn',
      '.add-to-cart-btn', '.btn-addtocart', '#AddToCart', '.shopify-payment-button__button'];
    let btn = null;
    for (const sel of selectors) { btn = document.querySelector(sel); if (btn) break; }
    if (!btn) btn = [...document.querySelectorAll('button')].find(b => /cart|buy|add/i.test(b.textContent));
    if (!btn) return { backgroundColor: '#1a1a2e', color: '#ffffff', fontFamily: 'system-ui,sans-serif', borderRadius: '6px', fontSize: '14px', padding: '12px 20px' };
    const s = window.getComputedStyle(btn);
    return { backgroundColor: s.backgroundColor, color: s.color, fontFamily: s.fontFamily, borderRadius: s.borderRadius, fontSize: s.fontSize, padding: s.padding };
  }

  function detectVariantId() {
    const fromUrl = new URLSearchParams(window.location.search).get('variant');
    if (fromUrl) return fromUrl;
    try { const v = window.ShopifyAnalytics?.meta?.selectedVariantId; if (v) return String(v); } catch {}
    const sel = document.querySelector('select[name="id"], input[name="id"]');
    if (sel?.value) return sel.value;
    return null;
  }

  function detectProduct() {
    let name = null, price = null;
    try { const m = window.ShopifyAnalytics?.meta?.product; if (m) { name = m.title || null; const v = m.variants?.[0]; if (v?.price) price = v.price / 100; } } catch {}
    if (!price || !name) {
      (document.querySelector('#MainContent, main') || document).querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try {
          const d = JSON.parse(s.textContent);
          const p = d['@type'] === 'Product' ? d : (d['@graph'] || []).find(n => n['@type'] === 'Product');
          if (p) { if (!name) name = p.name; if (!price) { const o = Array.isArray(p.offers) ? p.offers[0] : p.offers; if (o?.price) price = parseFloat(o.price); } }
        } catch {}
      });
    }
    if (!name) { const og = document.querySelector('meta[property="og:title"]'); if (og) name = og.getAttribute('content'); }
    if (!price) { const og = document.querySelector('meta[property="og:price:amount"]'); if (og) price = parseFloat(og.getAttribute('content')); }
    let image = null;
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) image = ogImage.getAttribute('content');
    return { name: name || document.title, price, url: window.location.href, image };
  }

  function findPlacement(position) {
    if ((position || 'below-cart') === 'below-cart') {
      for (const sel of ['[data-add-to-cart]', '.btn-cart', '#add-to-cart', '[name="add"]', '.product-form__cart-submit', '.add-to-cart-btn', '#AddToCart']) {
        const el = document.querySelector(sel); if (el) return el;
      }
    }
    if (position === 'floating') return null;
    return document.querySelector('form') || document.body;
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── STYLES ───────────────────────────────────────────────────────────────────
  function getButtonStyles(bg, fg, fontFamily, borderRadius, fontSize, padding, isFloating) {
    if (isFloating) return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :host { display: block; }
      #btn { display: flex; align-items: center; gap: 10px; background: ${bg}; color: ${fg};
        font-family: ${fontFamily || 'system-ui, sans-serif'}; font-size: 14px; font-weight: 600;
        padding: 14px 20px; border: none; border-radius: 50px; cursor: pointer; white-space: nowrap;
        box-shadow: 0 4px 20px rgba(0,0,0,0.25); transition: transform 0.15s, box-shadow 0.15s; }
      #btn:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
      .attr { font-size: 9px; color: #aaa; text-align: center; margin-top: 4px; font-family: system-ui,sans-serif; }
    `;
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :host { display: block; width: 100%; margin-top: 8px; }
      #btn { width: 100%; cursor: pointer; border: 1.5px solid ${bg}; background: transparent; color: ${bg};
        font-family: ${fontFamily || 'system-ui, sans-serif'}; font-size: ${fontSize || '14px'};
        border-radius: ${borderRadius || '6px'}; padding: ${padding || '12px 20px'};
        display: flex; align-items: center; justify-content: center; gap: 6px;
        font-weight: 500; transition: all 0.15s; line-height: 1.4; }
      #btn:hover { background: ${bg}; color: ${fg}; }
      .attr { font-size: 9px; color: #aaa; text-align: center; margin-top: 4px; font-family: system-ui,sans-serif; }
    `;
  }

  function getChatStyles(bg, fg, fontFamily) {
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      #overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 2147483646; display: flex; align-items: flex-end; justify-content: center; }
      #panel { background: #fff; border-radius: 16px 16px 0 0; width: 100%; max-width: 420px; height: 580px;
        display: flex; flex-direction: column; font-family: ${fontFamily}; overflow: hidden; box-shadow: 0 -8px 40px rgba(0,0,0,0.18); position: relative; }
      .hdr { padding: 16px 20px; background: ${bg}; color: ${fg}; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
      .hdr h3 { font-size: 15px; font-weight: 600; }
      .hdr p { font-size: 11px; opacity: 0.8; margin-top: 2px; }
      .close-btn { background: none; border: none; color: inherit; cursor: pointer; font-size: 20px; padding: 0 4px; }
      .msgs { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f7f7f8; }
      .msg { max-width: 85%; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.5; }
      .msg.bot { background: #fff; color: #1a1a1a; border-radius: 14px 14px 14px 2px; align-self: flex-start; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
      .lead-chip { margin-top: 8px; padding: 7px 11px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; font-size: 12px; color: #166534; display: flex; align-items: center; gap: 6px; cursor: pointer; transition: background 0.15s; }
      .lead-chip:hover { background: #dcfce7; }
      .lead-chip-icon { font-size: 14px; flex-shrink: 0; }
      .lead-chip-input { border: none; background: transparent; font-size: 12px; color: #166534; outline: none; width: 100%; font-family: inherit; }
      .lead-chip-input::placeholder { color: #4ade80; }
      .lead-chip-send { background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; flex-shrink: 0; font-family: inherit; }
      .msg.user { background: ${bg}; color: ${fg}; border-radius: 14px 14px 2px 14px; align-self: flex-end; }
      .typing { display: flex; align-items: center; gap: 4px; align-self: flex-start; padding: 10px 14px; background: #fff; border-radius: 14px 14px 14px 2px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
      .typing span { width: 6px; height: 6px; background: #bbb; border-radius: 50%; animation: bounce 1.2s infinite; }
      .typing span:nth-child(2) { animation-delay: 0.2s; }
      .typing span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
      .reaction { font-size: 12px; color: #6b7280; align-self: flex-end; padding: 2px 4px; animation: fadein 0.2s ease; }
      @keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      .input-row { display: flex; padding: 12px 16px; gap: 8px; border-top: 1px solid #eee; background: #fff; flex-shrink: 0; }
      .inp { flex: 1; border: 1.5px solid #ddd; border-radius: 20px; padding: 10px 16px; font-size: 13px; font-family: inherit; outline: none; transition: border 0.15s; }
      .inp:focus { border-color: ${bg}; }
      .send { background: ${bg}; color: ${fg}; border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .send:disabled { opacity: 0.5; cursor: default; }
      .deal-screen { position: absolute; inset: 0; background: #111; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; z-index: 20; transform: translateY(100%); transition: transform 0.5s ease-out; overflow: hidden; border-radius: 16px 16px 0 0; }
      .deal-screen.visible { transform: translateY(0); }
      .deal-check { margin-bottom: 18px; }
      .deal-check circle { opacity: 0; animation: circlein 0.3s ease-out 0.2s forwards; }
      @keyframes circlein { to { opacity: 1; } }
      .checkmark { animation: draw 0.4s ease-out 0.2s forwards; }
      @keyframes draw { to { stroke-dashoffset: 0; } }
      .deal-product { font-size: 12px; color: #888; margin-bottom: 10px; text-align: center; padding: 0 24px; }
      .deal-price-wrap { position: relative; text-align: center; margin-bottom: 6px; }
      .deal-price-num { font-size: 52px; font-weight: 800; color: #fff; line-height: 1; font-family: system-ui, sans-serif; }
      .deal-orig-num { font-size: 16px; color: #555; text-decoration: line-through; margin-bottom: 4px; text-align: center; }
      .deal-savings { display: inline-block; background: #1a472a; color: #7dcc99; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; margin-bottom: 18px; opacity: 0; transition: opacity 0.4s ease; }
      .deal-savings.show { opacity: 1; }
      .deal-code-line { font-size: 11px; color: #555; margin-bottom: 20px; letter-spacing: 0.02em; }
      .deal-timer-wrap { text-align: center; margin-bottom: 8px; }
      .deal-timer-digits { font-size: 28px; font-weight: 700; color: #fff; font-family: monospace; letter-spacing: 4px; transition: color 0.3s; }
      .deal-timer-digits.urgent { color: #e8534a; }
      .deal-timer-label { font-size: 11px; color: #555; margin-top: 2px; }
      .deal-redirect-label { font-size: 11px; color: #555; margin-top: 12px; }
      .deal-fallback { display: none; margin-top: 14px; padding: 10px 28px; background: #1a472a; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
      .deal-progress { position: absolute; bottom: 0; left: 0; height: 3px; background: #1a472a; width: 0%; transition: width 0.5s linear; }
    `;
  }

  // ── CHAT ─────────────────────────────────────────────────────────────────────
  function openChat(settings, buttonStyles, productInfo) {
    const existing = document.getElementById('_botiga_chat_host');
    if (existing) { existing.remove(); return; }

    const host = document.createElement('div');
    host.id = '_botiga_chat_host';
    const shadow = host.attachShadow({ mode: 'closed' });

    const bg = buttonStyles.backgroundColor;
    const fg = buttonStyles.color || '#fff';

    const style = document.createElement('style');
    style.textContent = getChatStyles(bg, fg, buttonStyles.fontFamily);
    shadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.innerHTML = `
      <div id="panel">
        <div class="hdr">
          <div><h3>&#128172; Make an offer</h3><p>${escHtml(productInfo.name || '')}</p></div>
          <button class="close-btn" id="close-btn">&#x2715;</button>
        </div>
        <div class="msgs" id="msgs"></div>
        <div class="input-row" id="input-row">
          <input class="inp" id="inp" type="text" placeholder="Type your offer or reply..." autocomplete="off" />
          <button class="send" id="send-btn" disabled>&#10148;</button>
        </div>
      </div>
    `;
    shadow.appendChild(overlay);
    document.body.appendChild(host);

    let negotiationId = null;
    let loading = false;
    let dealShown = false;

    const msgsEl = shadow.querySelector('#msgs');
    const inp = shadow.querySelector('#inp');
    const sendBtn = shadow.querySelector('#send-btn');

    shadow.querySelector('#close-btn').addEventListener('click', () => host.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) host.remove(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !sendBtn.disabled) send(); });
    sendBtn.addEventListener('click', send);

    // ── HELPERS ────────────────────────────────────────────────────────────────
    function appendMsg(role, text, needsLeadCapture) {
      removeTyping();
      const m = document.createElement('div');
      m.className = `msg ${role}`;
      m.textContent = text;

      if (role === 'bot' && needsLeadCapture) {
        const chip = document.createElement('div');
        chip.className = 'lead-chip';
        chip.innerHTML = `<span class="lead-chip-icon">📱</span><input class="lead-chip-input" placeholder="Phone or email — I'll hold this for you" type="text" autocomplete="off" /><button class="lead-chip-send">→</button>`;
        m.appendChild(chip);
        const chipInput = chip.querySelector('.lead-chip-input');
        const chipSend = chip.querySelector('.lead-chip-send');
        const submitChip = async () => {
          const val = chipInput.value.trim();
          if (!val) return;
          chip.innerHTML = `<span class="lead-chip-icon">✅</span><span>Got it — deal held for you!</span>`;
          try {
            await fetch(`${API_BASE}/api/negotiate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...API_HEADERS },
              body: JSON.stringify({ api_key: apiKey, session_id: getSessionId(), negotiation_id: negotiationId, product_name: productInfo.name, product_url: productInfo.url, variant_id: detectVariantId(), list_price: productInfo.price || 0, customer_message: val })
            });
          } catch {}
        };
        chipSend.addEventListener('click', submitChip);
        chipInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitChip(); });
      }

      msgsEl.appendChild(m);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return m;
    }

    function showTyping() {
      removeTyping();
      const t = document.createElement('div');
      t.className = 'typing';
      t.id = '_typing';
      t.innerHTML = '<span></span><span></span><span></span>';
      msgsEl.appendChild(t);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function removeTyping() {
      shadow.querySelector('#_typing')?.remove();
      shadow.querySelector('.reaction')?.remove();
    }

    function setLoading(state) {
      loading = state;
      sendBtn.disabled = state;
      inp.disabled = state;
    }

    function showOfferReaction(text) {
      if (!productInfo.price) return;
      const numMatch = text.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/);
      if (!numMatch) return;
      const offer = parseFloat(numMatch[1].replace(/[,\s]/g, ''));
      if (offer <= 0) return;
      const pct = offer / productInfo.price;
      let emoji, label;
      if (pct >= 0.90)      { emoji = '🤩'; label = 'Getting warmer...'; }
      else if (pct >= 0.80) { emoji = '😊'; label = 'Not bad...'; }
      else                  { emoji = '😬'; label = "That's a tough one..."; }
      const r = document.createElement('div');
      r.className = 'reaction';
      r.textContent = `${emoji} ${label}`;
      msgsEl.appendChild(r);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function getDelay(text) {
      if (!productInfo.price) return 1500;
      const numMatch = text.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/);
      if (!numMatch) return 1500;
      const offer = parseFloat(numMatch[1].replace(/[,\s]/g, ''));
      return (offer / productInfo.price) < 0.70 ? 2500 : 1500;
    }

    function showDeal(dealPrice, checkoutUrl, expiresAt, discountCode) {
      if (dealShown) return;
      dealShown = true;

      // Hide input row
      shadow.querySelector('#input-row')?.remove();

      const panel = shadow.querySelector('#panel');
      const listPrice = productInfo.price || dealPrice;
      const saved = Math.round(listPrice - dealPrice);
      const savedPct = Math.round((saved / listPrice) * 100);
      // Deal expires 10 minutes from now (or use server value)
      const exp = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 10 * 60 * 1000);

      // Build deal screen
      const ds = document.createElement('div');
      ds.className = 'deal-screen';
      ds.innerHTML = `
        <svg class="deal-check" viewBox="0 0 52 52" width="52" height="52">
          <circle cx="26" cy="26" r="24" fill="none" stroke="#1a472a" stroke-width="2"/>
          <path class="checkmark" fill="none" stroke="white" stroke-width="3"
            stroke-linecap="round" stroke-linejoin="round"
            d="M14 27l8 8 16-16"
            stroke-dasharray="36" stroke-dashoffset="36"/>
        </svg>
        <div class="deal-product">${escHtml(productInfo.name || '')}</div>
        <div class="deal-orig-num">${listPrice !== dealPrice ? '$' + Math.round(listPrice) : ''}</div>
        <div class="deal-price-wrap">
          <div class="deal-price-num" id="_dp">$${Math.round(listPrice)}</div>
        </div>
        <div class="deal-savings" id="_ds">${saved > 0 ? 'You saved $' + saved + ' &middot; ' + savedPct + '% off' : 'Deal locked in'}</div>
        ${discountCode ? `<div class="deal-code-line">${escHtml(discountCode)} applied automatically</div>` : ''}
        <div class="deal-timer-wrap">
          <div class="deal-timer-digits" id="_dtd">10:00</div>
          <div class="deal-timer-label">Deal expires in</div>
        </div>
        <div class="deal-redirect-label" id="_drl" style="opacity:0">Heading to your cart...</div>
        <button class="deal-fallback" id="_dfb">Go to cart &rarr;</button>
        <div class="deal-progress" id="_dpr"></div>
      `;
      panel.appendChild(ds);

      // MOMENT 1 — slide up
      requestAnimationFrame(() => { ds.classList.add('visible'); });

      // MOMENT 2 — price countdown with stamp overshoot
      setTimeout(() => {
        animatePrice(Math.round(listPrice), Math.round(dealPrice), 700, () => {
          const badge = shadow.querySelector('#_ds');
          if (badge) badge.classList.add('show');
        });
      }, 500);

      function animatePrice(from, to, duration, onComplete) {
        const start = performance.now();
        const range = from - to;
        function step(now) {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const overshoot = (progress > 0.85 && progress < 1)
            ? Math.sin(((progress - 0.85) / 0.15) * Math.PI) * 2 : 0;
          const current = Math.round(from - (range * eased) + overshoot);
          const el = shadow.querySelector('#_dp');
          if (el) el.textContent = '$' + current;
          if (progress < 1) { requestAnimationFrame(step); }
          else { if (el) el.textContent = '$' + to; onComplete && onComplete(); }
        }
        requestAnimationFrame(step);
      }

      // MOMENT 3 — confetti (bundled, above widget z-index)
      setTimeout(() => {
        try {
          console.log('[Botiga] firing confetti');
          const fire = require('canvas-confetti');
          const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#ffffff', '#FF8E53'];
          const opts = { zIndex: 2147483647, colors };
          fire({ ...opts, particleCount: 120, spread: 70, origin: { x: 0.3, y: 0.6 } });
          setTimeout(() => fire({ ...opts, particleCount: 120, spread: 70, origin: { x: 0.7, y: 0.6 } }), 150);
          setTimeout(() => fire({ ...opts, particleCount: 100, spread: 130, origin: { x: 0.5, y: 0.5 } }), 350);
        } catch (e) { console.error('[Botiga] confetti error:', e); }
      }, 700);

      // Countdown timer (deal expiry)
      const timerEl = shadow.querySelector('#_dtd');
      const timerInterval = setInterval(() => {
        const remaining = Math.max(0, exp - Date.now());
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        if (timerEl) {
          timerEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
          if (remaining < 120000) timerEl.classList.add('urgent');
        }
        if (remaining <= 0) {
          clearInterval(timerInterval);
          if (timerEl) timerEl.textContent = 'Expired';
          const fb = shadow.querySelector('#_dfb');
          if (fb) { fb.style.display = 'block'; fb.onclick = () => { if (checkoutUrl) window.location.href = checkoutUrl; }; }
        }
      }, 1000);

      // MOMENT 4 — redirect label, progress bar, auto-redirect
      setTimeout(() => {
        const lbl = shadow.querySelector('#_drl');
        if (lbl) lbl.style.opacity = '1';
      }, 1500);

      setTimeout(() => {
        const bar = shadow.querySelector('#_dpr');
        if (bar) bar.style.width = '100%';
        setTimeout(() => {
          if (checkoutUrl) {
            try { window.location.href = checkoutUrl; }
            catch {
              const fb = shadow.querySelector('#_dfb');
              if (fb) { fb.style.display = 'block'; fb.onclick = () => { window.location.href = checkoutUrl; }; }
            }
          } else {
            const fb = shadow.querySelector('#_dfb');
            if (fb) { fb.style.display = 'block'; fb.onclick = () => window.history.back(); }
          }
        }, 500);
      }, 2500);

      // Fallback button always wired
      const fb = shadow.querySelector('#_dfb');
      if (fb) fb.onclick = () => { if (checkoutUrl) window.location.href = checkoutUrl; };
    }

    // Lead capture is now handled inline by the bot's message — no form widget needed

    // ── OPENING CALL ───────────────────────────────────────────────────────────
    async function doOpening() {
      showTyping();
      await new Promise(r => setTimeout(r, 1200));
      try {
        const res = await fetch(`${API_BASE}/api/negotiate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...API_HEADERS },
          body: JSON.stringify({
            api_key: apiKey,
            session_id: getSessionId(),
            product_name: productInfo.name,
            product_url: productInfo.url,
            product_image: productInfo.image || null,
            variant_id: detectVariantId(),
            list_price: productInfo.price || 0,
            opening: true
          })
        });
        const d = await res.json();
        removeTyping();
        if (d.error) { appendMsg('bot', "Hey! Let's see if we can make a deal. What's your offer?"); }
        else {
          negotiationId = d.negotiation_id;
          saveSession({ negotiationId });
          appendMsg('bot', d.bot_reply, d.needs_lead_capture);
        }
      } catch {
        removeTyping();
        appendMsg('bot', "Hey! What offer did you have in mind? 😊");
      }
      setLoading(false);
      sendBtn.disabled = false;
      inp.disabled = false;
      setTimeout(() => inp.focus(), 80);
    }

    // ── SEND ───────────────────────────────────────────────────────────────────
    async function send() {
      const text = inp.value.trim();
      if (!text || loading) return;
      inp.value = '';

      appendMsg('user', text);
      showOfferReaction(text);

      const delay = getDelay(text);
      setLoading(true);
      await new Promise(r => setTimeout(r, delay));
      showTyping();

      try {
        const res = await fetch(`${API_BASE}/api/negotiate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...API_HEADERS },
          body: JSON.stringify({
            api_key: apiKey,
            session_id: getSessionId(),
            negotiation_id: negotiationId,
            product_name: productInfo.name,
            product_url: productInfo.url,
            product_image: productInfo.image || null,
            variant_id: detectVariantId(),
            list_price: productInfo.price || 0,
            customer_message: text
          })
        });
        const d = await res.json();
        removeTyping();

        if (d.error) {
          appendMsg('bot', "Sorry, having trouble — try again in a moment.");
          return;
        }

        negotiationId = d.negotiation_id;
        saveSession({ negotiationId });
        appendMsg('bot', d.bot_reply, d.needs_lead_capture);

        console.log('[Botiga] status:', d.status, '| deal_price:', d.deal_price, '| email_sent_to:', d.debug_email_sent_to);

        if (d.status === 'won' && d.deal_price) {
          saveSession({ deal: { price: d.deal_price, checkoutUrl: d.checkout_url, expiresAt: d.expires_at, discountCode: d.discount_code, productName: productInfo.name } });
          showDeal(d.deal_price, d.checkout_url, d.expires_at, d.discount_code);
        }
      } catch (err) {
        console.error('[Botiga] sendMessage error:', err);
        removeTyping();
        appendMsg('bot', "Connection issue — please try again.");
      } finally {
        setLoading(false);
      }
    }

    // Start with opening move
    setLoading(true);
    doOpening();

    return () => negotiationId;
  }

  // ── BUTTON ───────────────────────────────────────────────────────────────────
  function injectButton(settings, buttonStyles, productInfo, isFloating) {
    const host = document.createElement('div');
    host.id = '_botiga_btn_host';
    const shadow = host.attachShadow({ mode: 'closed' });

    const bg = overrideColor || settings.button_color || buttonStyles.backgroundColor;
    const fg = settings.button_text_color || buttonStyles.color || '#fff';
    const label = overrideLabel || settings.button_label || 'Make an offer';

    const style = document.createElement('style');
    style.textContent = getButtonStyles(bg, fg, buttonStyles.fontFamily, buttonStyles.borderRadius, buttonStyles.fontSize, buttonStyles.padding, isFloating);
    shadow.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'btn';
    btn.innerHTML = `&#10024; ${escHtml(label)}`;
    shadow.appendChild(btn);

    if (settings.plan !== 'white_label') {
      const attr = document.createElement('div');
      attr.className = 'attr';
      attr.textContent = 'Powered by botiga.ai';
      shadow.appendChild(attr);
    }

    let getNegId = () => null;
    btn.addEventListener('click', () => {
      const fn = openChat(settings, { backgroundColor: bg, color: fg, fontFamily: buttonStyles.fontFamily, borderRadius: buttonStyles.borderRadius }, productInfo);
      if (fn) getNegId = fn;
    });

    return { host, getNegId: () => getNegId() };
  }

  // ── EXIT INTENT ──────────────────────────────────────────────────────────────
  function setupExitIntent(getNegId) {
    let triggered = false;
    document.addEventListener('mouseleave', e => {
      if (e.clientY > 0 || triggered) return;
      const id = getNegId();
      if (!id) return;
      triggered = true;

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:2147483647;display:flex;align-items:flex-end;justify-content:center;';

      const sheet = document.createElement('div');
      sheet.style.cssText = 'background:#111;color:#fff;border-radius:20px 20px 0 0;width:100%;max-width:420px;padding:32px 28px 36px;font-family:system-ui,sans-serif;transform:translateY(100%);transition:transform 0.35s cubic-bezier(0.34,1.56,0.64,1);';
      sheet.innerHTML = `
        <div style="font-size:22px;margin-bottom:6px;">🎁</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:6px;letter-spacing:-0.3px;">Your surprise price is saved.</div>
        <div style="font-size:13px;color:#999;margin-bottom:22px;line-height:1.5;">Leave your number or email and we'll send it straight to you — ready to checkout whenever you are.</div>
        <input id="_bex_contact" type="text" placeholder="Phone number or email" style="width:100%;background:#1e1e1e;border:1px solid #333;border-radius:10px;padding:13px 16px;font-size:14px;color:#fff;outline:none;box-sizing:border-box;margin-bottom:12px;font-family:inherit;" />
        <button id="_bex_save" style="width:100%;padding:14px;background:#16a34a;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">Send me the deal</button>
        <button id="_bex_skip" style="display:block;width:100%;text-align:center;margin-top:14px;font-size:12px;color:#555;cursor:pointer;background:none;border:none;font-family:inherit;">No thanks</button>
      `;
      overlay.appendChild(sheet);
      document.body.appendChild(overlay);

      requestAnimationFrame(() => { sheet.style.transform = 'translateY(0)'; });

      const dismiss = () => {
        sheet.style.transform = 'translateY(100%)';
        setTimeout(() => overlay.remove(), 350);
      };
      sheet.querySelector('#_bex_skip').addEventListener('click', dismiss);
      overlay.addEventListener('click', ev => { if (ev.target === overlay) dismiss(); });
      sheet.querySelector('#_bex_save').addEventListener('click', async () => {
        const val = sheet.querySelector('#_bex_contact').value.trim();
        if (!val) return;
        const isPhone = /[\d\+\-\(\)\s]{7,}/.test(val);
        try {
          await fetch(`${API_BASE}/api/recovery/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...API_HEADERS },
            body: JSON.stringify({ negotiation_id: id, customer_whatsapp: isPhone ? val : null, customer_email: isPhone ? null : val })
          });
        } catch {}
        sheet.innerHTML = '<div style="text-align:center;padding:20px 0;"><div style="font-size:28px;margin-bottom:10px;">✅</div><div style="font-size:15px;font-weight:600;">Deal sent!</div><div style="font-size:13px;color:#999;margin-top:6px;">Check your messages.</div></div>';
        setTimeout(dismiss, 2200);
      });
    });
  }

  // ── CART DEAL TIMER BANNER ───────────────────────────────────────────────────
  function injectCartBanner() {
    const session = getSession();
    const deal = session.deal;
    if (!deal || !deal.expiresAt || !deal.checkoutUrl) return;

    const exp = new Date(deal.expiresAt);
    if (Date.now() >= exp) return; // already expired

    const banner = document.createElement('div');
    banner.id = '_botiga_cart_banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483645;background:#111;color:#fff;font-family:system-ui,sans-serif;padding:12px 20px;display:flex;align-items:center;justify-content:center;gap:16px;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,0.3);';
    banner.innerHTML = `
      <span>🎁 Your negotiated deal on <strong>${deal.productName || 'this item'}</strong> — <strong>$${deal.price}</strong>${deal.discountCode ? ' · code <code style="background:#222;padding:2px 6px;border-radius:4px;font-size:12px;">' + deal.discountCode + '</code>' : ''}</span>
      <span id="_bcb_timer" style="font-weight:700;font-variant-numeric:tabular-nums;color:#fbbf24;min-width:46px;text-align:right;"></span>
      <a href="${deal.checkoutUrl}" style="background:#16a34a;color:#fff;padding:7px 16px;border-radius:8px;font-weight:600;font-size:13px;text-decoration:none;white-space:nowrap;">Checkout →</a>
      <button id="_bcb_close" style="background:none;border:none;color:#666;font-size:18px;cursor:pointer;padding:0 4px;line-height:1;">×</button>
    `;
    document.body.prepend(banner);
    document.body.style.paddingTop = (parseInt(document.body.style.paddingTop || '0') + banner.offsetHeight) + 'px';

    banner.querySelector('#_bcb_close').addEventListener('click', () => {
      document.body.style.paddingTop = '';
      banner.remove();
    });

    const timerEl = banner.querySelector('#_bcb_timer');
    const tick = setInterval(() => {
      const remaining = Math.max(0, exp - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      if (remaining <= 120000) timerEl.style.color = '#ef4444';
      if (remaining <= 0) {
        clearInterval(tick);
        timerEl.textContent = 'Expired';
        banner.style.background = '#333';
        banner.querySelector('a').style.display = 'none';
      }
    }, 1000);
  }

  // ── INIT ─────────────────────────────────────────────────────────────────────
  function init(settings) {
    const isCart = window.location.pathname.includes('/cart');
    if (!settings.negotiate_on_product && !isCart) return;
    if (isCart && !settings.negotiate_on_cart) return;

    // Show deal timer banner on cart page if a deal is active
    if (isCart) injectCartBanner();

    const buttonStyles = detectStyles();
    const productInfo = detectProduct();
    const position = overridePosition || settings.button_position || 'below-cart';
    const isFloating = position === 'floating';
    const placement = findPlacement(position);

    const { host, getNegId } = injectButton(settings, buttonStyles, productInfo, isFloating);

    if (isFloating) {
      host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483645;';
      document.body.appendChild(host);
    } else if (placement) {
      placement.parentNode.insertBefore(host, placement.nextSibling);
    } else {
      document.body.appendChild(host);
    }

    if (settings.recovery_enabled) setupExitIntent(getNegId);
  }

  function run() {
    fetch(`${API_BASE}/api/widget/settings?k=${encodeURIComponent(apiKey)}`, { headers: API_HEADERS })
      .then(r => r.json())
      .then(settings => {
        if (settings.error) return;
        init(settings);
      })
      .catch(() => {});
  }



  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
