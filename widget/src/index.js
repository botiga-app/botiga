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
    return { name: name || document.title, price, url: window.location.href };
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
        display: flex; flex-direction: column; font-family: ${fontFamily}; overflow: hidden; box-shadow: 0 -8px 40px rgba(0,0,0,0.18); }
      .hdr { padding: 16px 20px; background: ${bg}; color: ${fg}; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
      .hdr h3 { font-size: 15px; font-weight: 600; }
      .hdr p { font-size: 11px; opacity: 0.8; margin-top: 2px; }
      .close-btn { background: none; border: none; color: inherit; cursor: pointer; font-size: 20px; padding: 0 4px; }
      .msgs { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f7f7f8; }
      .msg { max-width: 85%; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.5; }
      .msg.bot { background: #fff; color: #1a1a1a; border-radius: 14px 14px 14px 2px; align-self: flex-start; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
      .msg.user { background: ${bg}; color: ${fg}; border-radius: 14px 14px 2px 14px; align-self: flex-end; }
      .typing { display: flex; align-items: center; gap: 4px; align-self: flex-start; padding: 10px 14px; background: #fff; border-radius: 14px 14px 14px 2px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
      .typing span { width: 6px; height: 6px; background: #bbb; border-radius: 50%; animation: bounce 1.2s infinite; }
      .typing span:nth-child(2) { animation-delay: 0.2s; }
      .typing span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
      .reaction { font-size: 12px; color: #6b7280; align-self: flex-end; padding: 2px 4px; animation: fadein 0.2s ease; }
      @keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      .lead-form { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; max-width: 90%; align-self: flex-start; width: 100%; }
      .lead-form p { font-size: 12px; color: #374151; margin-bottom: 10px; line-height: 1.4; }
      .lead-form input { width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; font-size: 12px; margin-bottom: 8px; display: block; outline: none; }
      .lead-form input:focus { border-color: ${bg}; }
      .lead-form .submit-btn { width: 100%; padding: 9px; background: ${bg}; color: ${fg}; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
      .lead-form .skip-btn { display: block; text-align: center; font-size: 11px; color: #9ca3af; cursor: pointer; margin-top: 8px; background: none; border: none; width: 100%; }
      .input-row { display: flex; padding: 12px 16px; gap: 8px; border-top: 1px solid #eee; background: #fff; flex-shrink: 0; }
      .inp { flex: 1; border: 1.5px solid #ddd; border-radius: 20px; padding: 10px 16px; font-size: 13px; font-family: inherit; outline: none; transition: border 0.15s; }
      .inp:focus { border-color: ${bg}; }
      .send { background: ${bg}; color: ${fg}; border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .send:disabled { opacity: 0.5; cursor: default; }
      .deal-banner { padding: 16px; background: #f0fff4; border-top: 1px solid #d1fae5; flex-shrink: 0; }
      .deal-title { font-size: 14px; font-weight: 600; color: #065f46; margin-bottom: 6px; }
      .deal-prices { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
      .deal-price { font-size: 24px; font-weight: 700; color: #047857; }
      .deal-orig { font-size: 13px; color: #9ca3af; text-decoration: line-through; }
      .deal-code { display: inline-block; font-size: 11px; color: #065f46; background: #d1fae5; border-radius: 6px; padding: 3px 10px; margin-bottom: 6px; letter-spacing: 0.05em; font-weight: 600; }
      .deal-timer { font-size: 11px; color: #6b7280; margin-bottom: 10px; }
      .checkout-btn { display: block; width: 100%; padding: 12px; background: #047857; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
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
    let leadCaptured = false;
    let dealShown = false;

    const msgsEl = shadow.querySelector('#msgs');
    const inp = shadow.querySelector('#inp');
    const sendBtn = shadow.querySelector('#send-btn');

    shadow.querySelector('#close-btn').addEventListener('click', () => host.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) host.remove(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !sendBtn.disabled) send(); });
    sendBtn.addEventListener('click', send);

    // ── HELPERS ────────────────────────────────────────────────────────────────
    function appendMsg(role, text) {
      removeTyping();
      const m = document.createElement('div');
      m.className = `msg ${role}`;
      m.textContent = text;
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
      shadow.querySelector('#input-row')?.remove();
      const banner = document.createElement('div');
      banner.className = 'deal-banner';
      const exp = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 7200000);
      banner.innerHTML = `
        <div class="deal-title">&#127881; Deal locked in!</div>
        <div class="deal-prices">
          <span class="deal-price">$${parseFloat(dealPrice).toFixed(2)}</span>
          ${productInfo.price ? `<span class="deal-orig">$${parseFloat(productInfo.price).toFixed(2)}</span>` : ''}
        </div>
        ${discountCode ? `<div class="deal-code">Code: ${discountCode}</div>` : ''}
        <div class="deal-timer" id="ctdn"></div>
        <a href="${escHtml(checkoutUrl)}" class="checkout-btn" target="_top">Complete Purchase &#8594;</a>
      `;
      shadow.querySelector('#panel').appendChild(banner);
      const ctdn = shadow.querySelector('#ctdn');
      function tick() {
        const r = exp - Date.now();
        if (r <= 0) { ctdn.textContent = 'Deal expired'; return; }
        const h = Math.floor(r / 3600000), m = Math.floor((r % 3600000) / 60000), s = Math.floor((r % 60000) / 1000);
        ctdn.textContent = `Expires in: ${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
        setTimeout(tick, 1000);
      }
      tick();
    }

    function showLeadCapture(isFinalOffer) {
      if (leadCaptured) return;
      leadCaptured = true;
      const form = document.createElement('div');
      form.className = 'lead-form';
      form.innerHTML = `
        <p>${isFinalOffer ? "Don't want to miss this? Leave your details and our team will reach out." : "Want us to hold this price? Drop your details."}</p>
        <input id="_bl_name" type="text" placeholder="Your name" />
        <input id="_bl_phone" type="tel" placeholder="WhatsApp (e.g. +1234567890)" />
        <input id="_bl_email" type="email" placeholder="Email (optional)" />
        <button class="submit-btn" id="_bl_save">Send to team</button>
        <button class="skip-btn" id="_bl_skip">Skip for now</button>
      `;
      msgsEl.appendChild(form);
      msgsEl.scrollTop = msgsEl.scrollHeight;

      form.querySelector('#_bl_save').addEventListener('click', async () => {
        const name = form.querySelector('#_bl_name').value.trim();
        const phone = form.querySelector('#_bl_phone').value.trim();
        const email = form.querySelector('#_bl_email').value.trim();
        if (!phone && !email) return;
        try {
          await fetch(`${API_BASE}/api/recovery/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...API_HEADERS },
            body: JSON.stringify({ negotiation_id: negotiationId, customer_name: name || null, customer_whatsapp: phone || null, customer_email: email || null })
          });
        } catch {}
        form.innerHTML = '<p style="color:#047857;font-weight:600;padding:4px 0;">&#9989; Got it! Our team will reach out.</p>';
      });

      form.querySelector('#_bl_skip').addEventListener('click', () => form.remove());
    }

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
          appendMsg('bot', d.bot_reply);
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
        appendMsg('bot', d.bot_reply);

        if (d.status === 'won' && d.deal_price) {
          showDeal(d.deal_price, d.checkout_url, d.expires_at, d.discount_code);
          clearSession();
        } else if (d.is_final_offer && !leadCaptured) {
          setTimeout(() => showLeadCapture(true), 400);
        } else if (d.status === 'human_escalated' && !leadCaptured) {
          setTimeout(() => showLeadCapture(true), 400);
        }
      } catch {
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
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483647;display:flex;align-items:center;justify-content:center;';
      const popup = document.createElement('div');
      popup.style.cssText = 'background:#fff;border-radius:16px;padding:28px;width:340px;font-family:system-ui,sans-serif;';
      popup.innerHTML = `
        <h3 style="font-size:17px;font-weight:700;margin-bottom:6px;">Wait — hold your deal! &#129309;</h3>
        <p style="font-size:13px;color:#666;margin-bottom:16px;">Leave your details and we'll send you the deal to complete later.</p>
        <input id="_bex_phone" type="tel" placeholder="WhatsApp (e.g. +1234567890)" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:10px;display:block;box-sizing:border-box;" />
        <input id="_bex_email" type="email" placeholder="Or your email" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:10px;display:block;box-sizing:border-box;" />
        <button id="_bex_save" style="width:100%;padding:12px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Save my deal</button>
        <button id="_bex_skip" style="display:block;width:100%;text-align:center;margin-top:10px;font-size:12px;color:#999;cursor:pointer;background:none;border:none;">No thanks</button>
      `;
      overlay.appendChild(popup);
      document.body.appendChild(overlay);
      const dismiss = () => overlay.remove();
      popup.querySelector('#_bex_skip').addEventListener('click', dismiss);
      overlay.addEventListener('click', ev => { if (ev.target === overlay) dismiss(); });
      popup.querySelector('#_bex_save').addEventListener('click', async () => {
        const phone = popup.querySelector('#_bex_phone').value.trim();
        const email = popup.querySelector('#_bex_email').value.trim();
        if (!phone && !email) return;
        try {
          await fetch(`${API_BASE}/api/recovery/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...API_HEADERS },
            body: JSON.stringify({ negotiation_id: id, customer_whatsapp: phone || null, customer_email: email || null })
          });
        } catch {}
        popup.innerHTML = '<p style="font-size:14px;color:#047857;text-align:center;padding:20px 0;">&#9989; Deal saved! We\'ll send it to you.</p>';
        setTimeout(dismiss, 2000);
      });
    });
  }

  // ── INIT ─────────────────────────────────────────────────────────────────────
  function init(settings) {
    const isCart = window.location.pathname.includes('/cart');
    if (!settings.negotiate_on_product && !isCart) return;
    if (isCart && !settings.negotiate_on_cart) return;

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
