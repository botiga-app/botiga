(function () {
  'use strict';

  const script = document.currentScript ||
    document.querySelector('script[src*="/n.js"]') ||
    document.querySelector('script[data-api]');
  if (!script) return;

  const API_BASE = (script.dataset.api || 'https://api.botiga.ai').replace(/\/$/, '');
  console.log('[Botiga] widget init, API:', API_BASE);

  const apiKey = (script.src ? new URL(script.src).searchParams.get('k') : null) || script.dataset.k;
  if (!apiKey) return;

  const overrideColor = script.dataset.color || null;
  const overrideLabel = script.dataset.label || null;
  const overridePosition = script.dataset.position || null;

  const API_HEADERS = { 'ngrok-skip-browser-warning': '1' };

  function getSessionId() {
    const key = '_botiga_sid';
    let sid = sessionStorage.getItem(key);
    if (!sid) {
      sid = btoa([Math.random().toString(36).slice(2), screen.width, screen.height, navigator.userAgent.length].join('|')).replace(/=/g, '');
      sessionStorage.setItem(key, sid);
    }
    return sid;
  }

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
    if (!price) { try { const m = window.meta?.product; if (m) { name = name || m.title; if (m.price) price = m.price / 100; } } catch {} }
    if (!price || !name) {
      const main = document.querySelector('#MainContent, main, [role="main"]');
      (main || document).querySelectorAll('script[type="application/ld+json"]').forEach(s => {
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
      #panel { background: #fff; border-radius: 16px 16px 0 0; width: 100%; max-width: 420px; height: 560px;
        display: flex; flex-direction: column; font-family: ${fontFamily}; overflow: hidden; box-shadow: 0 -8px 40px rgba(0,0,0,0.18); }
      .hdr { padding: 16px 20px; background: ${bg}; color: ${fg}; display: flex; align-items: center; justify-content: space-between; }
      .hdr h3 { font-size: 15px; font-weight: 600; }
      .hdr p { font-size: 11px; opacity: 0.8; margin-top: 2px; }
      .close-btn { background: none; border: none; color: inherit; cursor: pointer; font-size: 20px; padding: 0 4px; }
      .msgs { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f7f7f8; }
      .msg { max-width: 85%; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.5; }
      .msg.bot { background: #fff; color: #1a1a1a; border-radius: 14px 14px 14px 2px; align-self: flex-start; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
      .msg.user { background: ${bg}; color: ${fg}; border-radius: 14px 14px 2px 14px; align-self: flex-end; }
      .typing { font-size: 12px; color: #999; align-self: flex-start; padding: 6px 0; }
      .reaction { font-size: 12px; color: #6b7280; align-self: flex-end; padding: 2px 4px; animation: fadein 0.2s ease; }
      @keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      .lead-form { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; margin-top: 8px; max-width: 85%; align-self: flex-start; }
      .lead-form input { width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; font-size: 12px; margin-bottom: 6px; display: block; box-sizing: border-box; outline: none; }
      .lead-form input:focus { border-color: ${bg}; }
      .lead-form button { width: 100%; padding: 8px; background: ${bg}; color: ${fg}; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
      .lead-form .skip { display: block; text-align: center; font-size: 11px; color: #9ca3af; cursor: pointer; margin-top: 6px; background: none; border: none; width: 100%; }
      .input-row { display: flex; padding: 12px 16px; gap: 8px; border-top: 1px solid #eee; background: #fff; }
      .inp { flex: 1; border: 1.5px solid #ddd; border-radius: 20px; padding: 10px 16px; font-size: 13px; font-family: inherit; outline: none; transition: border 0.15s; }
      .inp:focus { border-color: ${bg}; }
      .send { background: ${bg}; color: ${fg}; border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .send:disabled { opacity: 0.5; cursor: default; }
      .deal-banner { padding: 16px; background: #f0fff4; border-top: 1px solid #d1fae5; }
      .deal-title { font-size: 14px; font-weight: 600; color: #065f46; margin-bottom: 4px; }
      .deal-price { font-size: 22px; font-weight: 700; color: #047857; }
      .deal-orig { font-size: 12px; color: #999; text-decoration: line-through; margin-left: 6px; }
      .deal-timer { font-size: 11px; color: #6b7280; margin-top: 4px; }
      .deal-code { font-size: 12px; color: #065f46; background: #d1fae5; border-radius: 6px; padding: 4px 10px; display: inline-block; margin-top: 6px; letter-spacing: 0.05em; }
      .checkout-btn { display: block; width: 100%; margin-top: 12px; padding: 12px; background: #047857; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
    `;
  }

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
        <div class="msgs" id="msgs">
          <div class="msg bot">Hey! I see you're interested in <strong>${escHtml(productInfo.name || 'this item')}</strong>${productInfo.price ? ` (listed at <strong>$${productInfo.price}</strong>)` : ''}. What offer did you have in mind? &#128522;</div>
        </div>
        <div class="input-row" id="input-row">
          <input class="inp" id="inp" type="text" placeholder="Type your offer..." autocomplete="off" />
          <button class="send" id="send-btn">&#10148;</button>
        </div>
      </div>
    `;
    shadow.appendChild(overlay);
    document.body.appendChild(host);

    let negotiationId = null;
    let loading = false;
    let botMessageCount = 0;
    let leadCaptured = false;
    const msgsEl = shadow.querySelector('#msgs');
    const inp = shadow.querySelector('#inp');
    const sendBtn = shadow.querySelector('#send-btn');

    shadow.querySelector('#close-btn').addEventListener('click', () => host.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) host.remove(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    sendBtn.addEventListener('click', send);
    setTimeout(() => inp.focus(), 80);

    function appendMsg(role, text) {
      shadow.querySelector('.typing')?.remove();
      const m = document.createElement('div');
      m.className = `msg ${role}`;
      m.textContent = text;
      msgsEl.appendChild(m);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return m;
    }

    function setLoading(state) {
      loading = state;
      sendBtn.disabled = state;
      if (state) {
        const t = document.createElement('div');
        t.className = 'typing';
        t.textContent = 'typing...';
        msgsEl.appendChild(t);
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
    }

    // Immediate visual reaction to customer offer — runs before API responds
    function showOfferReaction(text) {
      const numMatch = text.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/);
      if (!numMatch || !productInfo.price) return;
      const offer = parseFloat(numMatch[1].replace(/[,\s]/g, ''));
      if (offer <= 0 || offer > productInfo.price * 1.5) return;
      const pct = offer / productInfo.price;
      let emoji, label;
      if (pct >= 0.90) { emoji = '🤩'; label = 'Getting warmer...'; }
      else if (pct >= 0.80) { emoji = '😊'; label = 'Not bad...'; }
      else { emoji = '😬'; label = "That's a tough one..."; }
      const r = document.createElement('div');
      r.className = 'reaction';
      r.textContent = `${emoji} ${label}`;
      msgsEl.appendChild(r);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      // Remove once bot replies
      setTimeout(() => r.remove(), 4000);
    }

    // Tactical delay: low offers get longer pause to feel considered
    function getResponseDelay(text) {
      const numMatch = text.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/);
      if (!numMatch || !productInfo.price) return 1500;
      const offer = parseFloat(numMatch[1].replace(/[,\s]/g, ''));
      const pct = offer / productInfo.price;
      return pct < 0.70 ? 2500 : 1500;
    }

    function showLeadCapture() {
      if (leadCaptured) return;
      const form = document.createElement('div');
      form.className = 'lead-form';
      form.innerHTML = `
        <input id="_bl_phone" type="tel" placeholder="WhatsApp (e.g. +1234567890)" />
        <input id="_bl_email" type="email" placeholder="Email (optional)" />
        <button id="_bl_save">Hold this price for me</button>
        <button class="skip" id="_bl_skip">Skip</button>
      `;
      msgsEl.appendChild(form);
      msgsEl.scrollTop = msgsEl.scrollHeight;

      form.querySelector('#_bl_save').addEventListener('click', async () => {
        const phone = form.querySelector('#_bl_phone').value.trim();
        const email = form.querySelector('#_bl_email').value.trim();
        if (!phone && !email) return;
        leadCaptured = true;
        try {
          await fetch(`${API_BASE}/api/recovery/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...API_HEADERS },
            body: JSON.stringify({ negotiation_id: negotiationId, customer_whatsapp: phone || null, customer_email: email || null })
          });
        } catch {}
        form.innerHTML = '<p style="font-size:12px;color:#047857;text-align:center;padding:8px 0;">✅ Got it! We\'ll hold this price for you.</p>';
        setTimeout(() => inp.focus(), 100);
      });

      form.querySelector('#_bl_skip').addEventListener('click', () => {
        leadCaptured = true;
        form.remove();
        inp.focus();
      });
    }

    function showDeal(dealPrice, listPrice, checkoutUrl, expiresAt, discountCode) {
      shadow.querySelector('#input-row')?.remove();
      const banner = document.createElement('div');
      banner.className = 'deal-banner';
      const exp = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 7200000);
      banner.innerHTML = `
        <div class="deal-title">&#127881; Deal locked in!</div>
        <div>
          <span class="deal-price">$${parseFloat(dealPrice).toFixed(2)}</span>
          ${listPrice ? `<span class="deal-orig">$${parseFloat(listPrice).toFixed(2)}</span>` : ''}
        </div>
        ${discountCode ? `<div class="deal-code">Use code: <strong>${discountCode}</strong></div>` : ''}
        <div class="deal-timer" id="ctdn">Expires in: ...</div>
        <a href="${checkoutUrl}" class="checkout-btn" target="_top">Complete Purchase &#8594;</a>
      `;
      shadow.querySelector('#panel').appendChild(banner);
      const ctdn = shadow.querySelector('#ctdn');
      const tick = () => {
        const r = exp - Date.now();
        if (r <= 0) { ctdn.textContent = 'Deal expired'; return; }
        const h = Math.floor(r / 3600000), m = Math.floor((r % 3600000) / 60000), s = Math.floor((r % 60000) / 1000);
        ctdn.textContent = `Expires in: ${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
        setTimeout(tick, 1000);
      };
      tick();
    }

    async function send() {
      const text = inp.value.trim();
      if (!text || loading) return;
      inp.value = '';
      appendMsg('user', text);

      // Immediate offer reaction (client-side, no API needed)
      showOfferReaction(text);

      // Tactical delay before showing typing indicator
      const delay = getResponseDelay(text);
      await new Promise(r => setTimeout(r, delay));

      setLoading(true);
      try {
        const r = await fetch(`${API_BASE}/api/negotiate`, {
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
        const d = await r.json();
        if (d.error) { appendMsg('bot', "Sorry, having trouble right now. Try again!"); return; }
        negotiationId = d.negotiation_id;
        appendMsg('bot', d.bot_reply);
        botMessageCount++;

        // Show inline lead capture after bot's first counter
        if (botMessageCount === 1 && !leadCaptured && d.status === 'active') {
          setTimeout(showLeadCapture, 300);
        }

        if (d.status === 'won' && d.deal_price) {
          showDeal(d.deal_price, productInfo.price, d.checkout_url, d.expires_at, d.discount_code);
        }
      } catch { appendMsg('bot', "Connection issue — please try again."); }
      finally { setLoading(false); }
    }

    return () => negotiationId;
  }

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

  function setupExitIntent(getNegId) {
    let triggered = false;
    document.addEventListener('mouseleave', e => {
      if (e.clientY <= 0 && !triggered) {
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
          <input id="_bex_phone" type="tel" placeholder="WhatsApp (e.g. +1234567890)" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:10px;display:block;" />
          <input id="_bex_email" type="email" placeholder="Or your email" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:10px;display:block;" />
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
      }
    });
  }

  function init(settings, autoOpen) {
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

    // Auto-open chat after dwell time if configured
    if (autoOpen && settings.dwell_time_seconds > 0) {
      setTimeout(() => {
        const btn = host.shadowRoot?.querySelector('#btn') || host.querySelector('#btn');
        if (btn) btn.click();
      }, settings.dwell_time_seconds * 1000);
    }

    if (settings.recovery_enabled) setupExitIntent(getNegId);
  }

  function run() {
    console.log('[Botiga] fetching settings for key:', apiKey);
    fetch(`${API_BASE}/api/widget/settings?k=${encodeURIComponent(apiKey)}`, { headers: API_HEADERS })
      .then(r => r.json())
      .then(settings => {
        console.log('[Botiga] settings received:', settings);
        if (settings.error) { console.log('[Botiga] settings error, aborting'); return; }
        // Button always injects immediately — dwell only controls auto-open
        init(settings, true);
      })
      .catch(e => console.log('[Botiga] settings fetch failed:', e));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
