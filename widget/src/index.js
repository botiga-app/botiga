(function () {
  'use strict';

  // Read config from script tag
  // document.currentScript is null when script runs async/deferred — fall back to querying by src
  const script = document.currentScript ||
    document.querySelector('script[src*="/n.js"]') ||
    document.querySelector('script[data-api]');
  if (!script) return;

  // data-api allows overriding the API base URL for testing/self-hosting
  const API_BASE = (script.dataset.api || 'https://api.botiga.ai').replace(/\/$/, '');
  console.log('[Botiga] widget init, API:', API_BASE);

  const apiKey = (script.src ? new URL(script.src).searchParams.get('k') : null) || script.dataset.k;
  if (!apiKey) return;

  const overrideColor = script.dataset.color || null;
  const overrideLabel = script.dataset.label || null;
  const overridePosition = script.dataset.position || null;

  // Simple session fingerprint
  function getSessionId() {
    const key = '_botiga_sid';
    let sid = sessionStorage.getItem(key);
    if (!sid) {
      sid = btoa([
        Math.random().toString(36).slice(2),
        screen.width, screen.height,
        navigator.userAgent.length
      ].join('|')).replace(/=/g, '');
      sessionStorage.setItem(key, sid);
    }
    return sid;
  }

  // Detect merchant's add-to-cart button styles
  function detectStyles() {
    const selectors = [
      '[data-add-to-cart]', '.btn-cart', '#add-to-cart', '[name="add"]',
      '.product-form__cart-submit', '.product-form__submit',
      'button[type="submit"].btn', '.add-to-cart-btn', '.btn-addtocart',
      '#AddToCart', '.shopify-payment-button__button'
    ];
    let btn = null;
    for (const sel of selectors) {
      btn = document.querySelector(sel);
      if (btn) break;
    }
    if (!btn) {
      const all = [...document.querySelectorAll('button')];
      btn = all.find(b => /cart|buy|add/i.test(b.textContent));
    }
    if (!btn) return { backgroundColor: '#1a1a2e', color: '#ffffff', fontFamily: 'system-ui,sans-serif', borderRadius: '6px', fontSize: '14px', padding: '12px 20px' };
    const s = window.getComputedStyle(btn);
    return { backgroundColor: s.backgroundColor, color: s.color, fontFamily: s.fontFamily, borderRadius: s.borderRadius, fontSize: s.fontSize, padding: s.padding };
  }

  // Detect Shopify variant ID from URL or page
  function detectVariantId() {
    // From URL ?variant=XXXXX
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get('variant');
    if (fromUrl) return fromUrl;
    // From ShopifyAnalytics
    try {
      const v = window.ShopifyAnalytics?.meta?.selectedVariantId;
      if (v) return String(v);
    } catch {}
    // From select element
    const sel = document.querySelector('select[name="id"], input[name="id"]');
    if (sel?.value) return sel.value;
    return null;
  }

  // Detect product info from page
  function detectProduct() {
    let name = null, price = null;

    // 1. Shopify exposes product data globally — most reliable
    try {
      const meta = window.ShopifyAnalytics?.meta?.product;
      if (meta) {
        name = meta.title || null;
        // price is in cents
        const variant = meta.variants?.[0];
        if (variant?.price) price = variant.price / 100;
      }
    } catch {}

    // 2. Shopify theme sometimes exposes window.meta
    if (!price) {
      try {
        const meta = window.meta?.product;
        if (meta) {
          name = name || meta.title;
          if (meta.price) price = meta.price / 100;
        }
      } catch {}
    }

    // 3. JSON-LD structured data — scoped to main product only (not recommendations)
    if (!price || !name) {
      const mainContent = document.querySelector('#MainContent, main, [role="main"]');
      const scripts = (mainContent || document).querySelectorAll('script[type="application/ld+json"]');
      scripts.forEach(s => {
        try {
          const d = JSON.parse(s.textContent);
          const p = d['@type'] === 'Product' ? d : (d['@graph'] || []).find(n => n['@type'] === 'Product');
          if (p) {
            if (!name) name = p.name;
            if (!price) {
              const o = Array.isArray(p.offers) ? p.offers[0] : p.offers;
              if (o?.price) price = parseFloat(o.price);
            }
          }
        } catch {}
      });
    }

    // 4. og:title for name
    if (!name) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) name = ogTitle.getAttribute('content');
    }

    // 5. og:price as last resort for price
    if (!price) {
      const ogPrice = document.querySelector('meta[property="og:price:amount"]');
      if (ogPrice) price = parseFloat(ogPrice.getAttribute('content'));
    }

    return { name: name || document.title, price, url: window.location.href };
  }

  // Find where to inject the button
  function findPlacement(position) {
    const pos = position || 'below-cart';
    if (pos === 'below-cart') {
      const selectors = [
        '[data-add-to-cart]', '.btn-cart', '#add-to-cart', '[name="add"]',
        '.product-form__cart-submit', '.add-to-cart-btn', '#AddToCart'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
    }
    if (pos === 'floating') return null; // handled separately
    return document.querySelector('form') || document.body;
  }

  // CSS for the shadow DOM
  function getStyles(bg, fg, fontFamily, borderRadius, fontSize, padding, isFloating) {
    if (isFloating) {
      return `
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :host { display: block; }
        #btn {
          display: flex; align-items: center; gap: 10px;
          background: ${bg}; color: ${fg};
          font-family: ${fontFamily || 'system-ui, sans-serif'};
          font-size: 14px; font-weight: 600;
          padding: 14px 20px; border: none; border-radius: 50px;
          cursor: pointer; white-space: nowrap;
          box-shadow: 0 4px 20px rgba(0,0,0,0.25);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        #btn:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
        .attr { font-size: 9px; color: #aaa; text-align: center; margin-top: 4px; font-family: system-ui,sans-serif; }
      `;
    }
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :host { display: block; width: 100%; margin-top: 8px; }
      #btn {
        width: 100%; cursor: pointer; border: 1.5px solid ${bg};
        background: transparent; color: ${bg};
        font-family: ${fontFamily || 'system-ui, sans-serif'};
        font-size: ${fontSize || '14px'};
        border-radius: ${borderRadius || '6px'};
        padding: ${padding || '12px 20px'};
        display: flex; align-items: center; justify-content: center; gap: 6px;
        font-weight: 500; transition: all 0.15s; line-height: 1.4;
      }
      #btn:hover { background: ${bg}; color: ${fg}; }
      .attr { font-size: 9px; color: #aaa; text-align: center; margin-top: 4px; font-family: system-ui,sans-serif; }
    `;
  }

  function getChatStyles(bg, fg, fontFamily, borderRadius) {
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      #overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.45);
        z-index: 2147483646; display: flex; align-items: flex-end; justify-content: center;
      }
      #panel {
        background: #fff; border-radius: 16px 16px 0 0;
        width: 100%; max-width: 420px; height: 520px;
        display: flex; flex-direction: column;
        font-family: ${fontFamily}; overflow: hidden;
        box-shadow: 0 -8px 40px rgba(0,0,0,0.18);
      }
      .hdr {
        padding: 16px 20px; background: ${bg}; color: ${fg};
        display: flex; align-items: center; justify-content: space-between;
      }
      .hdr h3 { font-size: 15px; font-weight: 600; }
      .hdr p { font-size: 11px; opacity: 0.8; margin-top: 2px; }
      .close-btn { background: none; border: none; color: inherit; cursor: pointer; font-size: 20px; padding: 0 4px; }
      .msgs {
        flex: 1; overflow-y: auto; padding: 16px;
        display: flex; flex-direction: column; gap: 10px; background: #f7f7f8;
      }
      .msg { max-width: 80%; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.5; }
      .msg.bot { background: #fff; color: #1a1a1a; border-radius: 14px 14px 14px 2px; align-self: flex-start; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
      .msg.user { background: ${bg}; color: ${fg}; border-radius: 14px 14px 2px 14px; align-self: flex-end; }
      .typing { font-size: 12px; color: #999; align-self: flex-start; padding: 6px 0; }
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
      .checkout-btn {
        display: block; width: 100%; margin-top: 12px; padding: 12px;
        background: #047857; color: #fff; border: none; border-radius: 8px;
        font-size: 14px; font-weight: 600; cursor: pointer; text-align: center;
        text-decoration: none;
      }
    `;
  }

  function openChat(settings, buttonStyles, productInfo) {
    const existing = document.getElementById('_botiga_chat_host');
    if (existing) { existing.remove(); return; }

    const host = document.createElement('div');
    host.id = '_botiga_chat_host';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    const bg = buttonStyles.backgroundColor;
    const fg = buttonStyles.color || '#fff';
    style.textContent = getChatStyles(bg, fg, buttonStyles.fontFamily, buttonStyles.borderRadius);
    shadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.innerHTML = `
      <div id="panel">
        <div class="hdr">
          <div>
            <h3>&#128172; Make an offer</h3>
            <p>${escHtml(productInfo.name || '')}</p>
          </div>
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

    function showDeal(dealPrice, listPrice, checkoutUrl, expiresAt) {
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
        if (d.status === 'won' && d.deal_price) {
          showDeal(d.deal_price, productInfo.price, d.checkout_url, d.expires_at);
        }
      } catch { appendMsg('bot', "Connection issue — please try again."); }
      finally { setLoading(false); }
    }

    // Return negotiationId getter for exit intent
    return () => negotiationId;
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function injectButton(settings, buttonStyles, productInfo, getNegId, isFloating) {
    const host = document.createElement('div');
    host.id = '_botiga_btn_host';
    const shadow = host.attachShadow({ mode: 'closed' });

    const bg = overrideColor || settings.button_color || buttonStyles.backgroundColor;
    const fg = settings.button_text_color || buttonStyles.color || '#fff';
    const label = overrideLabel || settings.button_label || 'Make an offer';

    const style = document.createElement('style');
    style.textContent = getStyles(bg, fg, buttonStyles.fontFamily, buttonStyles.borderRadius, buttonStyles.fontSize, buttonStyles.padding, isFloating);
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

    btn.addEventListener('click', () => {
      const getIdFn = openChat(settings, { backgroundColor: bg, color: fg, fontFamily: buttonStyles.fontFamily, borderRadius: buttonStyles.borderRadius }, productInfo);
      if (getIdFn) getNegId = getIdFn;
    });

    return host;
  }

  function setupExitIntent(settings, getNegId) {
    let triggered = false;
    document.addEventListener('mouseleave', e => {
      if (e.clientY <= 0 && !triggered) {
        const id = getNegId();
        if (!id) return;
        triggered = true;
        // Show exit intent popup
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
        overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });
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

  function init(settings) {
    const isProductPage = settings.negotiate_on_product;
    const isCartPage = settings.negotiate_on_cart;
    const path = window.location.pathname;
    const isCart = path.includes('/cart');

    console.log('[Botiga] init — isProductPage:', isProductPage, 'isCart:', isCart);
    if (!isProductPage && !isCart) { console.log('[Botiga] not a product or cart page, skipping'); return; }
    if (isCart && !isCartPage) { console.log('[Botiga] cart page disabled, skipping'); return; }

    const buttonStyles = detectStyles();
    const productInfo = detectProduct();
    console.log('[Botiga] placement target:', findPlacement(settings.button_position || 'below-cart'));

    let getNegId = () => null;

    const position = overridePosition || settings.button_position || 'below-cart';
    const isFloating = position === 'floating';
    const placement = findPlacement(position);

    const widgetHost = injectButton(settings, buttonStyles, productInfo, getNegId, isFloating);

    if (isFloating) {
      widgetHost.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483645;';
      document.body.appendChild(widgetHost);
    } else if (placement) {
      placement.parentNode.insertBefore(widgetHost, placement.nextSibling);
    } else {
      document.body.appendChild(widgetHost);
    }

    if (settings.recovery_enabled) {
      setupExitIntent(settings, getNegId);
    }
  }

  // Headers added to every API request — ngrok-skip-browser-warning bypasses
  // ngrok's free-tier interstitial page when testing locally
  const API_HEADERS = { 'ngrok-skip-browser-warning': '1' };

  // Wait for DOM then fetch settings and inject
  function run() {
    console.log('[Botiga] fetching settings for key:', apiKey);
    fetch(`${API_BASE}/api/widget/settings?k=${encodeURIComponent(apiKey)}`, { headers: API_HEADERS })
      .then(r => r.json())
      .then(settings => {
        console.log('[Botiga] settings received:', settings);
        if (settings.error) { console.log('[Botiga] settings error, aborting'); return; }

        if (settings.dwell_time_seconds > 0) {
          console.log('[Botiga] waiting', settings.dwell_time_seconds, 's before inject');
          setTimeout(() => init(settings), settings.dwell_time_seconds * 1000);
        } else {
          console.log('[Botiga] injecting immediately');
          init(settings);
        }
      })
      .catch((e) => {
        console.log('[Botiga] settings fetch failed:', e);
        // Silent fail — widget simply doesn't appear
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
