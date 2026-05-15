(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  // Accept the API key from any of three locations so the same script
  // works whether merchants paste manually or we auto-install via the
  // Shopify Script Tags API (which can't set custom attributes — only
  // src — so ?k=<key> in the URL is the only viable path):
  //   1. ?k=<key> URL parameter on the script src   (preferred)
  //   2. data-key="<key>" attribute                  (legacy)
  //   3. data-k="<key>" attribute                    (matches n.js convention)
  var API_KEY = (function () {
    if (script.src) {
      try { var k = new URL(script.src).searchParams.get('k'); if (k) return k; } catch (_) {}
    }
    return script.getAttribute('data-key') || script.getAttribute('data-k') || '';
  })();
  // Derive API base in priority order: data-api / data-key attribute →
  // infer from the script's own src URL → hardcoded fallback. The middle
  // step is critical for the auto-install path: Shopify Script Tags API
  // only allows setting src (no custom attributes), so the auto-installed
  // video.js has no data-api. Reading the src origin makes that work.
  var API_BASE = (function () {
    var fromAttr = script.getAttribute('data-api');
    if (fromAttr) return fromAttr.replace(/\/$/, '');
    if (script.src) {
      try { return new URL(script.src).origin; } catch (_) {}
    }
    return 'https://botiga-api-two.vercel.app';
  })();
  var GRID_TITLE = script.hasAttribute('data-grid-title')
    ? script.getAttribute('data-grid-title')
    : 'Watch & Shop';
  var EMBED_MODE = script.getAttribute('data-layout') === 'embed';
  var SESSION_ID = 'btgv_' + Math.random().toString(36).slice(2);
  // SESSION_TOKEN persists across page loads so multi-item negotiations link to one Draft Order
  var SESSION_TOKEN = (function () {
    try {
      var key = '_btgv_tok_' + API_KEY;
      var raw = localStorage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.id && (Date.now() - (parsed.ts || 0)) < 86400000) return parsed.id;
      var id = 'btgvs_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      localStorage.setItem(key, JSON.stringify({ id: id, ts: Date.now() }));
      return id;
    } catch (e) { return SESSION_ID; }
  })();
  var BOT_NAME = script.getAttribute('data-bot-name') || 'Botiga';
  var BOT_SUBTITLE = script.getAttribute('data-bot-subtitle') || 'AI Shopping Assistant · Online';
  var BOT_GREETING = script.getAttribute('data-greeting') || "Hi! 👋 What can I help you find today?";
  var BOT_PERSONALITY = script.getAttribute('data-bot-personality') || 'salesy';
  var BOT_AVATAR = script.getAttribute('data-bot-avatar') || null;
  var AUTO_OPEN_DELAY = script.hasAttribute('data-auto-open') ? parseInt(script.getAttribute('data-auto-open'), 10) : 3000;

  if (!API_KEY) return;

  var allVideos = [], allCols = [], likedSet = {};
  var storyEl = null, storyVideos = [], storyIdx = 0, storyAnimFrame = null;
  var feedEl = null, pollTimer = null;
  var launcherEl = null;
  var _cncgEl = null, _cncgOpen = false, _cncgHistory = [];
  var _btgNegProduct = null;
  // In-chat negotiation state. When `active`, _cncgSend routes the customer's
  // next message to /api/negotiate (with the tracked negotiation_id) instead
  // of the conversational /api/widget/chat. Cleared on deal close/abandon.
  var _btgNegoChat = { active: false, negotiationId: null, productInfo: null, listPrice: 0 };

  // Per-product eligibility cache. Keyed by handle. Avoid hitting
  // /widget/product-rules on every render — fetch once per product per page.
  var _btgRulesCache = {};
  function _btgvFetchProductRules(handle, tags, cb) {
    if (!handle) { cb && cb({ negotiable: true }); return; }
    if (_btgRulesCache[handle]) { cb && cb(_btgRulesCache[handle]); return; }
    var qs = '?k=' + API_KEY + '&handle=' + encodeURIComponent(handle);
    if (tags && tags.length) qs += '&tags=' + encodeURIComponent(tags.join(','));
    fetch(API_BASE + '/api/widget/product-rules' + qs)
      .then(function (r) { return r.ok ? r.json() : { negotiable: true }; })
      .then(function (d) { _btgRulesCache[handle] = d; cb && cb(d); })
      .catch(function () { cb && cb({ negotiable: true }); });
  }

  // ─── Deal persistence (localStorage, 24h TTL) ────────────────────────────────
  function _btgvSaveDeal(deal) {
    try {
      var key = '_btgv_deals_' + API_KEY;
      var existing = _btgvGetDeals();
      // Replace if same negotiation ID, otherwise append
      var idx = existing.findIndex ? existing.findIndex(function (d) { return d.negotiationId === deal.negotiationId; }) : -1;
      if (idx >= 0) existing[idx] = deal; else existing.push(deal);
      // Prune expired
      var now = Date.now();
      existing = existing.filter(function (d) { return !d.expiresAt || new Date(d.expiresAt).getTime() > now; });
      localStorage.setItem(key, JSON.stringify(existing));
    } catch (e) {}
  }

  function _btgvGetDeals() {
    try {
      var raw = localStorage.getItem('_btgv_deals_' + API_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      var now = Date.now();
      return arr.filter(function (d) { return !d.expiresAt || new Date(d.expiresAt).getTime() > now; });
    } catch (e) { return []; }
  }

  function _btgvRemoveDeal(negotiationId) {
    try {
      var deals = _btgvGetDeals().filter(function (d) { return d.negotiationId !== negotiationId; });
      localStorage.setItem('_btgv_deals_' + API_KEY, JSON.stringify(deals));
    } catch (e) {}
  }

  // ─── Supabase Realtime ───────────────────────────────────────────────────────
  var _rtCfg = null, _rtWs = null, _rtHb = null, _rtRef = 0;

  function rtGetConfig(cb) {
    if (_rtCfg) return cb ? cb(_rtCfg) : null;
    fetch(API_BASE + '/api/widget/config?k=' + API_KEY)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        _rtCfg = d;
        // Apply merchant-configured bot settings (only if not overridden by script attr)
        if (d.bot_name && !script.getAttribute('data-bot-name')) BOT_NAME = d.bot_name;
        if (d.bot_subtitle && !script.getAttribute('data-bot-subtitle')) BOT_SUBTITLE = d.bot_subtitle;
        if (d.bot_greeting && !script.getAttribute('data-greeting')) BOT_GREETING = d.bot_greeting;
        if (d.bot_avatar_url && !script.getAttribute('data-bot-avatar')) BOT_AVATAR = d.bot_avatar_url;
        if (d.bot_personality && !script.getAttribute('data-bot-personality')) BOT_PERSONALITY = d.bot_personality;
        if (d.auto_open_delay !== undefined && d.auto_open_delay !== null && !script.hasAttribute('data-auto-open')) AUTO_OPEN_DELAY = d.auto_open_delay;
        if (d.widget_theme) _btgvApplyTheme(d.widget_theme);
        if (cb && d.supabase_url && d.supabase_anon_key) cb(d);
      }).catch(function () {});
  }

  function rtConnect(videoId, onLike) {
    rtGetConfig(function (cfg) {
      rtDisconnect();
      var wsUrl = cfg.supabase_url.replace(/^https?/, function (p) { return p === 'https' ? 'wss' : 'ws'; })
        + '/realtime/v1/websocket?apikey=' + cfg.supabase_anon_key + '&vsn=1.0.0';
      var ws;
      try { ws = new WebSocket(wsUrl); } catch (e) { return; }
      _rtWs = ws;
      var prevLikes = null;

      ws.onopen = function () {
        ws.send(JSON.stringify({
          topic: 'realtime:btgv_' + videoId,
          event: 'phx_join',
          payload: {
            config: {
              broadcast: { self: false },
              presence: { key: '' },
              postgres_changes: [{ event: 'UPDATE', schema: 'public', table: 'videos', filter: 'id=eq.' + videoId }]
            }
          },
          ref: String(++_rtRef)
        }));
        _rtHb = setInterval(function () {
          if (ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++_rtRef) }));
        }, 25000);
      };

      ws.onmessage = function (e) {
        try {
          var msg = JSON.parse(e.data);
          if (msg.event !== 'postgres_changes') return;
          var rec = (msg.payload && msg.payload.data && msg.payload.data.new) || {};
          var newLikes = rec.likes_count;
          if (newLikes == null) return;
          if (prevLikes !== null && newLikes > prevLikes) {
            var diff = Math.min(newLikes - prevLikes, 6);
            for (var i = 0; i < diff; i++) {
              (function (delay) { setTimeout(onLike, delay); })(i * 120);
            }
          }
          prevLikes = newLikes;
        } catch (_) {}
      };

      ws.onclose = function () { clearInterval(_rtHb); };
    });
  }

  function rtDisconnect() {
    clearInterval(_rtHb); _rtHb = null;
    if (_rtWs) { try { _rtWs.close(); } catch (_) {} _rtWs = null; }
  }

  // ─── Heart particles ─────────────────────────────────────────────────────────
  var _hearts = ['❤️', '🧡', '💕', '💗', '💖', '❤️', '💓', '💝', '❤️', '💗'];
  function spawnHeart() {
    var count = 6 + Math.floor(Math.random() * 5);
    for (var i = 0; i < count; i++) {
      (function (delay) {
        setTimeout(function () {
          var el = document.createElement('div');
          el.className = '_btgv_heart';
          el.textContent = _hearts[Math.floor(Math.random() * _hearts.length)];
          var size = 16 + Math.random() * 36;
          var x = Math.random() * window.innerWidth;
          var dx = (Math.random() - 0.5) * 120;
          var dy = window.innerHeight * (0.55 + Math.random() * 0.45);
          var dur = (1.8 + Math.random() * 1.4).toFixed(2);
          var rot = ((Math.random() - 0.5) * 30).toFixed(1);
          var rot2 = ((Math.random() - 0.5) * 60).toFixed(1);
          el.style.cssText = 'left:' + x + 'px;top:-' + (size + 10) + 'px;font-size:' + size + 'px;--dx:' + dx + 'px;--dy:' + dy + 'px;--dur:' + dur + 's;--rot:' + rot + 'deg;--rot2:' + rot2 + 'deg';
          document.body.appendChild(el);
          el.addEventListener('animationend', function () { el.remove(); });
        }, delay);
      })(i * 80);
    }
  }

  // ── Deep link helpers ───────────────────────────────────────────────────────
  var _deepLinkOrig = null;
  function pushDeepLink(id) {
    if (_deepLinkOrig === null) _deepLinkOrig = window.location.href;
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('btgv', String(id));
      history.replaceState(null, '', url.toString());
    } catch (e) {}
  }
  function popDeepLink() {
    if (_deepLinkOrig !== null) {
      try { history.replaceState(null, '', _deepLinkOrig); } catch (e) {}
      _deepLinkOrig = null;
    }
  }

  // ─── Fetch ──────────────────────────────────────────────────────────────────
  function get(url, cb) {
    fetch(url)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (d) { cb(d || []); })
      .catch(function () { cb([]); });
  }
  function fetchCollections(cb) { get(API_BASE + '/api/widget/collections?k=' + API_KEY, cb); }
  function fetchCollectionVideos(id, cb) { get(API_BASE + '/api/widget/videos?k=' + API_KEY + '&w=' + id, cb); }
  function fetchAllVideos(cb) { get(API_BASE + '/api/widget/videos?k=' + API_KEY, cb); }

  // ─── Analytics ──────────────────────────────────────────────────────────────
  function track(videoId, eventType, productId) {
    fetch(API_BASE + '/api/widget/videos/' + videoId + '/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: API_KEY, event_type: eventType, session_id: SESSION_ID, product_id: productId || null })
    }).catch(function () {});
  }

  // ─── Containers ─────────────────────────────────────────────────────────────
  function getStoriesContainer() {
    var el = document.getElementById('btgv-stories');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'btgv-stories';
    var ref = document.querySelector('header') || document.querySelector('[data-section-type="header"]');
    if (ref && ref.parentNode) ref.parentNode.insertBefore(el, ref.nextSibling);
    else (document.querySelector('main') || document.body).prepend(el);
    return el;
  }

  function getGridContainer() {
    var el = document.getElementById('btgv-grid');
    if (!el) {
      el = document.createElement('div');
      el.id = 'btgv-grid';
      var stories = document.getElementById('btgv-stories');
      if (stories && stories.parentNode) stories.parentNode.insertBefore(el, stories.nextSibling);
      else (document.querySelector('main') || document.body).prepend(el);
    }
    return el;
  }

  // ─── Confetti ───────────────────────────────────────────────────────────────
  function fireConfetti() {
    var c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999999;width:100%;height:100%';
    document.body.appendChild(c);
    var ctx = c.getContext('2d');
    c.width = window.innerWidth; c.height = window.innerHeight;
    var pieces = [], colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#fff'];
    for (var i = 0; i < 140; i++) {
      pieces.push({
        x: Math.random() * c.width, y: -20,
        w: Math.random() * 10 + 4, h: Math.random() * 6 + 3,
        color: colors[i % colors.length], rot: Math.random() * Math.PI * 2,
        vx: (Math.random() - 0.5) * 6, vy: Math.random() * 5 + 3, vr: (Math.random() - 0.5) * 0.15
      });
    }
    var start = null, dur = 2800;
    function draw(ts) {
      if (!start) start = ts;
      var t = ts - start;
      ctx.clearRect(0, 0, c.width, c.height);
      pieces.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, 1 - t / dur);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (t < dur) requestAnimationFrame(draw); else c.remove();
    }
    requestAnimationFrame(draw);
  }

  // ─── Cart ───────────────────────────────────────────────────────────────────
  function addToCart(variantId, cb) {
    if (!variantId) { if (cb) cb(false); return; }
    fetch('/cart/add.js', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: parseInt(variantId, 10), quantity: 1 }] })
    })
      .then(function (r) {
        var ok = r.ok;
        if (ok) {
          // Most Shopify themes (and the standard cart drawer apps like
          // Cart Drawer, Slide Cart, etc.) listen for one of these events
          // to refresh their cart count badge. We fire all the common
          // names so the theme picks up the change without a page reload.
          ['cart:updated', 'cart:refresh', 'cart:update', 'theme:cart:add'].forEach(function (evt) {
            try { document.dispatchEvent(new CustomEvent(evt, { detail: { variantId: variantId, quantity: 1 } })); } catch (_) {}
          });
          // Also refetch /cart.js so any theme observing fetch responses
          // (Online Store 2.0 patterns) sees the new cart state.
          fetch('/cart.js').catch(function () {});
        }
        if (cb) cb(ok);
      })
      .catch(function () { if (cb) cb(false); });
  }

  // ─── Theme tokens — per-merchant widget colors applied as CSS custom
  // properties on the concierge root. Merchants set widget_theme JSONB on
  // merchant_settings; /api/widget/config returns it; we apply it at boot.
  // Only the keys present override; everything else falls back to the
  // built-in dark default in CSS.
  var _THEME_KEYS = [
    'primary', 'primary_text', 'surface', 'surface_text',
    'bot_bubble_bg', 'bot_bubble_text', 'header_bg', 'header_text',
    'font_family',
  ];
  function _btgvApplyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    // Stash for late-mounted elements (concierge root may not exist yet)
    window._btgvTheme = theme;
    function paint(el) {
      if (!el) return;
      _THEME_KEYS.forEach(function (k) {
        var v = theme[k];
        if (typeof v === 'string' && v) el.style.setProperty('--btgv-' + k.replace(/_/g, '-'), v);
      });
    }
    // Try now; the concierge root is created lazily, so also expose the
    // function for the constructor to call when it mounts.
    paint(document.getElementById('_btgv_cncg'));
    paint(document.documentElement);
  }

  // ─── Cart attribution — when concierge adds, mark the cart so merchants
  // see "this order was assisted by {bot}" in admin AND the customer sees
  // a small badge in the cart drawer. Mirrors REP AI's pattern.
  function _btgvAttributeCart(cb) {
    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attributes: {
          '__assisted_by': BOT_NAME,
          '__assisted_at': new Date().toISOString(),
        },
      }),
    }).catch(function () {}).finally(function () { if (cb) cb(); });
  }

  // Try to render a "🤝 This order was assisted by {bot}" badge inside
  // the merchant's cart drawer. Theme-agnostic: scans common drawer
  // selectors over a short window and injects once. Idempotent.
  function _btgvInjectCartBadge() {
    var BADGE_ID = '_btgv_cart_badge';
    var done = false;
    function tryInject() {
      if (done || document.getElementById(BADGE_ID)) return;
      var drawer = document.querySelector(
        '#CartDrawer, .cart-drawer, .cart__drawer, [data-cart-drawer], ' +
        '#cart-drawer, .drawer--cart, #sidebar-cart, .mini-cart, .ajaxcart, ' +
        'cart-drawer, cart-notification'
      );
      if (!drawer) return;
      var visible = drawer.offsetParent !== null ||
                    drawer.classList.contains('is-open') ||
                    drawer.classList.contains('active') ||
                    drawer.getAttribute('open') !== null;
      if (!visible) return;
      var badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 12px;margin:8px 0;font:500 12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#666;background:#f7f7f7;border-radius:6px;justify-content:center;';
      badge.innerHTML = '<span style="font-size:14px;">🤝</span><span>This order was assisted by ' + BOT_NAME + '</span>';
      drawer.appendChild(badge);
      done = true;
    }
    // Try a few times — drawer often renders after add-to-cart with a delay
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++; tryInject();
      if (done || attempts > 20) clearInterval(iv);
    }, 250);
  }

  // ─── Feed pause/resume — keep the video focused while user is acting on it ──
  function pauseFeedForAction() {
    if (!feedEl) return;
    var scroll = feedEl.querySelector('#_btgv_scroll');
    if (scroll) {
      scroll._prevOverflowY = scroll.style.overflowY;
      scroll._prevTouchAction = scroll.style.touchAction;
      scroll.style.overflowY = 'hidden';
      scroll.style.touchAction = 'none';
    }
    feedEl.querySelectorAll('._btgv_slide video').forEach(function (v) {
      if (!v.paused) { v._wasPlaying = true; v.pause(); }
    });
  }

  function resumeFeedAfterAction() {
    if (!feedEl) return;
    var scroll = feedEl.querySelector('#_btgv_scroll');
    if (scroll) {
      scroll.style.overflowY = scroll._prevOverflowY || '';
      scroll.style.touchAction = scroll._prevTouchAction || '';
      delete scroll._prevOverflowY;
      delete scroll._prevTouchAction;
    }
    feedEl.querySelectorAll('._btgv_slide video').forEach(function (v) {
      if (v._wasPlaying) {
        v._wasPlaying = false;
        try { v.currentTime = 0; } catch (_) {}
        v.play().catch(function () {});
      }
    });
  }

  // Resume whenever the negotiation modal closes
  document.addEventListener('botiga:neg-closed', resumeFeedAfterAction);

  // ─── Styles ─────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('_btgv_css')) return;
    var s = document.createElement('style');
    s.id = '_btgv_css';
    s.textContent = [
      // Stories bar
      '#btgv-stories{width:100%;background:#fff;border-bottom:1px solid #efefef;display:flex;justify-content:center}',
      '#_btgv_sr{display:flex;gap:16px;padding:14px 20px 16px;overflow-x:auto;max-width:100%;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
      '#_btgv_sr::-webkit-scrollbar{display:none}',
      '._btgv_story{flex-shrink:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;-webkit-tap-highlight-color:transparent}',
      '._btgv_story_ring{width:90px;height:90px;border-radius:50%;padding:3px;background:linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)}',
      '._btgv_story_ring.seen{background:#c7c7c7}',
      '._btgv_story_inner{width:100%;height:100%;border-radius:50%;overflow:hidden;border:3px solid #fff;background:#222}',
      '._btgv_story_inner img,._btgv_story_inner video{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}',
      '._btgv_story_lbl{font-size:11px;color:#262626;max-width:90px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}',

      // Story viewer
      '#_btgv_sv{position:fixed;inset:0;z-index:99999;background:#000;opacity:0;pointer-events:none;transition:opacity .2s;overflow:hidden;touch-action:none}',
      '#_btgv_sv.open{opacity:1;pointer-events:all}',
      '._btgv_sv_prog{position:absolute;top:0;left:0;right:0;display:flex;gap:3px;padding:env(safe-area-inset-top,10px) 10px 0;z-index:10;box-sizing:border-box}',
      '@media(min-width:640px){._btgv_sv_prog{max-width:420px;left:50%;transform:translateX(-50%)}}',
      '._btgv_sv_bar{flex:1;height:2px;background:rgba(255,255,255,.4);border-radius:2px;overflow:hidden}',
      '._btgv_sv_fill{height:100%;background:#fff;width:0%;border-radius:2px}',
      '._btgv_sv_hd{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,10px) + 12px);display:flex;align-items:center;gap:10px;padding:0 12px;z-index:10}',
      '@media(min-width:640px){._btgv_sv_hd{max-width:420px;left:50%;transform:translateX(-50%)}}',
      '._btgv_sv_av{width:36px;height:36px;border-radius:50%;border:1.5px solid rgba(255,255,255,.85);overflow:hidden;flex-shrink:0;background:#333}',
      '._btgv_sv_av img{width:100%;height:100%;object-fit:cover}',
      '._btgv_sv_nm{color:#fff;font-size:13px;font-weight:600;flex:1;text-shadow:0 1px 3px rgba(0,0,0,.5)}',
      '._btgv_sv_x{width:32px;height:32px;background:rgba(0,0,0,.4);border-radius:50%;border:none;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);flex-shrink:0}',
      '._btgv_sv_vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
      '@media(min-width:640px){._btgv_sv_vid{max-width:420px;left:50%;transform:translateX(-50%);object-fit:contain}}',
      '._btgv_sv_tl{position:absolute;left:0;top:0;width:30%;height:60%;z-index:5}',
      '._btgv_sv_tr{position:absolute;right:0;top:0;width:70%;height:60%;z-index:5}',

      // Watch & Shop carousel wrapper
      '#btgv-grid{width:100%;max-width:1200px;margin:0 auto;padding-top:8px}',
      '._btgv_gh{font-size:20px;font-weight:800;color:#111;text-align:center;padding:20px 16px 12px;letter-spacing:.5px;text-transform:uppercase}',
      // Outer: relative for arrow positioning
      '._btgv_gi_outer{position:relative;padding:0 44px}',
      '@media(max-width:480px){._btgv_gi_outer{padding:0 36px}}',
      // Scroll container — horizontal only, no scrollbar
      '#_btgv_gi_wrap{overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;scroll-behavior:smooth}',
      '#_btgv_gi_wrap::-webkit-scrollbar{display:none}',
      // min-width:100% ensures % widths on children resolve against the scroll wrapper, not the flex container
      '#_btgv_gi{display:flex;gap:8px;min-width:100%}',
      // Cell: 4 per view desktop, 3 tablet, 2 mobile
      '._btgv_gc{flex-shrink:0;width:calc(25% - 6px);scroll-snap-align:start;position:relative;overflow:hidden;background:#111;cursor:pointer;-webkit-tap-highlight-color:transparent;border-radius:12px}',
      '@media(max-width:900px){._btgv_gc{width:calc(33.333% - 6px)}}',
      '@media(max-width:540px){._btgv_gc{width:calc(50% - 4px)}}',
      '._btgv_gc video{width:100%;height:100%;object-fit:cover;display:block}',
      '._btgv_gc_ov{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.8) 0%,transparent 50%);pointer-events:none}',
      // Arrow buttons
      '._btgv_arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:5;width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,.92);color:#111;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.18);transition:opacity .2s,transform .15s;-webkit-tap-highlight-color:transparent}',
      '._btgv_arrow:hover{background:#fff;transform:translateY(-50%) scale(1.08)}',
      '._btgv_arrow_l{left:4px}',
      '._btgv_arrow_r{right:4px}',
      '._btgv_arrow.hidden{opacity:0;pointer-events:none}',
      // Product overlay on carousel cell — bottom portion only
      '._btgv_gc_prod{position:absolute;bottom:0;left:0;right:0;padding:6px 8px 9px;z-index:3;pointer-events:none}',
      '._btgv_gc_prod_nm{color:#fff;font-size:10px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;text-shadow:0 1px 3px rgba(0,0,0,.8)}',
      '._btgv_gc_prod_pr{color:rgba(255,255,255,.85);font-size:10px;font-weight:500;margin-bottom:6px;text-shadow:0 1px 3px rgba(0,0,0,.8)}',
      '._btgv_gc_prod_btns{display:flex;gap:4px;pointer-events:all}',
      '._btgv_gc_prod_btn{flex:1;border:none;border-radius:8px;padding:5px 2px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;-webkit-tap-highlight-color:transparent;transition:opacity .15s}',
      '._btgv_gc_prod_btn:active{opacity:.7}',
      '._btgv_gc_prod_btn span:first-child{font-size:13px;line-height:1}',
      '._btgv_gc_prod_btn span:last-child{font-size:7px;font-weight:700;line-height:1;white-space:nowrap}',
      '._btgv_gc_pb_cart{background:rgba(255,255,255,.18);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.22)}',
      '._btgv_gc_pb_buy{background:linear-gradient(135deg,#FF6B35 0%,#F72585 100%);box-shadow:0 4px 14px rgba(247,37,133,.32)}',
      '._btgv_gc_pb_neg{background:linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%);box-shadow:0 4px 14px rgba(247,37,133,.36)}',

      // TikTok feed overlay
      '#_btgv_feed{position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-direction:column;opacity:0;pointer-events:none;transition:opacity .25s}',
      '#_btgv_feed.open{opacity:1;pointer-events:all}',
      '#_btgv_scroll{flex:1;overflow-y:scroll;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
      '#_btgv_scroll::-webkit-scrollbar{display:none}',
      '._btgv_slide{position:relative;width:100%;height:100dvh;scroll-snap-align:start;scroll-snap-stop:always;display:flex;align-items:center;justify-content:center;background:#000;flex-shrink:0}',
      '._btgv_slide video{width:100%;height:100%;object-fit:cover;display:block}',
      '@media(min-width:640px){._btgv_slide video{max-width:420px;border-radius:14px}}',
      '._btgv_grad{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.78) 0%,rgba(0,0,0,.1) 50%,transparent 75%);pointer-events:none}',
      '@media(min-width:640px){._btgv_grad{max-width:420px;left:50%;transform:translateX(-50%);border-radius:14px}}',
      '#_btgv_close{position:absolute;top:env(safe-area-inset-top,16px);right:16px;width:36px;height:36px;background:rgba(0,0,0,.5);border-radius:50%;border:none;color:#fff;font-size:20px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)}',
      '#_btgv_mute{position:absolute;top:env(safe-area-inset-top,16px);left:16px;width:36px;height:36px;background:rgba(0,0,0,.5);border-radius:50%;border:none;color:#fff;font-size:16px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)}',
      '._btgv_rail{position:absolute;right:12px;bottom:250px;display:flex;flex-direction:column;align-items:center;gap:18px;z-index:6}',
      '@media(min-width:640px){._btgv_rail{right:calc(50% - 198px)}}',
      '._btgv_rail button{background:rgba(0,0,0,.45);backdrop-filter:blur(8px);border:none;border-radius:50%;width:48px;height:48px;color:#fff;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:12px;transition:transform .15s;will-change:transform}',
      '._btgv_rail button:active{transform:scale(.9)}',
      // Spring-pop animation for the like button when the customer taps —
      // gives instant visual feedback before the realtime echo brings the
      // count + heart particles. End at scale(1) so the button returns
      // smoothly instead of snapping back from 1.1.
      '@keyframes _btgv_like_pop{0%{transform:scale(1)}40%{transform:scale(1.4)}70%{transform:scale(.92)}100%{transform:scale(1)}}',
      '._btgv_rail button._btgv_popping{animation:_btgv_like_pop 500ms cubic-bezier(.34,1.56,.64,1)}',
      '._btgv_rail button._btgv_popping span:first-child{display:inline-block;animation:_btgv_like_pop 500ms cubic-bezier(.34,1.56,.64,1)}',

      // ─── Top chrome: brand badge (left) + progress bar + views (right) ──
      // Right padding clears the close button (#_btgv_close at right:16px,
      // 36px wide) so the views pill never hides under it.
      '._btgv_topbar{position:absolute;top:env(safe-area-inset-top,12px);left:0;right:0;z-index:8;display:flex;align-items:center;justify-content:space-between;padding:10px 60px 10px 14px;pointer-events:none}',
      '@media(min-width:640px){._btgv_topbar{max-width:420px;left:50%;transform:translateX(-50%)}}',
      '._btgv_brand{display:flex;align-items:center;gap:7px;background:rgba(0,0,0,.42);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);padding:4px 10px 4px 4px;border-radius:99px;color:#fff;text-decoration:none;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent;transition:transform .15s}',
      '._btgv_brand:active{transform:scale(.96)}',
      '._btgv_brand_logo{width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.95);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#111;font-weight:700}',
      '._btgv_brand_logo img{width:100%;height:100%;object-fit:cover}',
      '._btgv_brand_name{font-size:11.5px;font-weight:700;letter-spacing:.01em;max-width:30vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '._btgv_topright{display:flex;align-items:center;gap:8px;pointer-events:auto}',
      // Old _btgv_views moves into the topright group; rule already exists
      '._btgv_progress{position:absolute;top:0;left:0;height:2px;background:rgba(255,255,255,.65);width:0;border-radius:0 2px 2px 0;transition:width .15s linear;pointer-events:none;z-index:9}',
      '@media(min-width:640px){._btgv_progress{max-width:420px;left:50%;transform:translateX(-50%)}}',

      // ─── Tap layer for double-tap-to-like (Instagram pattern) ──────────
      '._btgv_taplayer{position:absolute;inset:0;z-index:5;background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '@media(min-width:640px){._btgv_taplayer{max-width:420px;left:50%;transform:translateX(-50%);border-radius:14px}}',
      '@keyframes _btgv_dtheart_burst{0%{transform:translate(-50%,-50%) scale(.3) rotate(-12deg);opacity:0}30%{transform:translate(-50%,-50%) scale(1.4) rotate(8deg);opacity:1}80%{transform:translate(-50%,-50%) scale(1.2) rotate(-4deg);opacity:.9}100%{transform:translate(-50%,-50%) scale(.8) rotate(0deg);opacity:0}}',
      '._btgv_dtheart{position:absolute;font-size:88px;pointer-events:none;z-index:7;text-shadow:0 4px 24px rgba(247,37,133,.4);animation:_btgv_dtheart_burst 850ms cubic-bezier(.22,.61,.36,1) forwards;will-change:transform,opacity}',
      // Pause overlay shown briefly when user taps to pause
      '@keyframes _btgv_pause_fade{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}30%{opacity:.85;transform:translate(-50%,-50%) scale(1)}70%{opacity:.85}100%{opacity:0;transform:translate(-50%,-50%) scale(1.2)}}',
      '._btgv_pauseicon{position:absolute;top:50%;left:50%;width:72px;height:72px;background:rgba(0,0,0,.55);backdrop-filter:blur(8px);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:30px;pointer-events:none;z-index:7;animation:_btgv_pause_fade 700ms ease-out forwards}',

      // ─── Bottom zone: caption + price pill + primary CTA ────────────────
      // Tightened spacing — was ~130px, now ~85px. Brand handle dropped
      // (already shown top-left) so we don't waste vertical real estate.
      '._btgv_bzone{position:absolute;bottom:0;left:0;right:0;z-index:8;padding:10px 12px calc(env(safe-area-inset-bottom,0px) + 10px);background:linear-gradient(to top,rgba(0,0,0,.92) 0%,rgba(0,0,0,.55) 65%,transparent 100%);display:flex;flex-direction:column;gap:6px;pointer-events:none}',
      '@media(min-width:640px){._btgv_bzone{max-width:420px;left:50%;transform:translateX(-50%);border-radius:0 0 14px 14px}}',
      '._btgv_bzone>*{pointer-events:auto}',
      // Caption: title only (no brand handle — that lives top-left)
      '._btgv_captext{font-size:12px;color:rgba(255,255,255,.94);line-height:1.3;text-shadow:0 1px 3px rgba(0,0,0,.55);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer;font-weight:500}',
      '._btgv_captext._btgv_capexpand{-webkit-line-clamp:unset;display:block}',
      // Compact price line — single row with all the price signal
      '._btgv_priceline{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '._btgv_price_now{color:#fff;font-size:16px;font-weight:800;text-shadow:0 1px 3px rgba(0,0,0,.5);letter-spacing:-.01em}',
      '._btgv_price_was{color:rgba(255,255,255,.5);font-size:11.5px;text-decoration:line-through}',
      '._btgv_price_disc{background:#ff4d6d;color:#fff;font-size:9px;font-weight:800;padding:2px 5px;border-radius:99px;letter-spacing:.03em}',
      '._btgv_price_aslow{color:rgba(255,255,255,.92);font-size:10.5px;font-weight:600;padding:2px 7px 2px 5px;border-radius:99px;background:linear-gradient(135deg,rgba(255,193,7,.22),rgba(247,37,133,.22));border:1px solid rgba(255,193,7,.36);display:inline-flex;align-items:center;gap:3px}',
      // Primary CTA + small inline icon-only buttons
      '._btgv_ctarow{display:flex;align-items:stretch;gap:6px;margin-top:1px}',
      '._btgv_cta_neg{flex:1;background:linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%);color:#fff;border:none;border-radius:11px;padding:10px 12px;font-size:13px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 18px rgba(247,37,133,.32);font-family:inherit;-webkit-tap-highlight-color:transparent;transition:transform .12s,box-shadow .12s;letter-spacing:.01em}',
      '._btgv_cta_neg:active{transform:scale(.97);box-shadow:0 2px 10px rgba(247,37,133,.32)}',
      '._btgv_cta_inline{width:42px;flex-shrink:0;border:none;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;color:#fff;font-family:inherit;-webkit-tap-highlight-color:transparent;transition:transform .12s,opacity .15s}',
      '._btgv_cta_inline:active{transform:scale(.94)}',
      '._btgv_cta_cart{background:rgba(255,255,255,.18);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.22)}',
      '._btgv_cta_buy{background:linear-gradient(135deg,#FF6B35 0%,#F72585 100%);box-shadow:0 4px 14px rgba(247,37,133,.32)}',
      // Small hearts that explode out of the like button on tap (5 directions)
      '@keyframes _btgv_lh_fly{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}15%{opacity:1;transform:translate(calc(-50% + var(--lhx)*.3),calc(-50% + var(--lhy)*.3)) scale(1)}100%{opacity:0;transform:translate(calc(-50% + var(--lhx)),calc(-50% + var(--lhy))) scale(.6)}}',
      '._btgv_lh{position:absolute;top:50%;left:50%;font-size:14px;pointer-events:none;will-change:transform,opacity;animation:_btgv_lh_fly 700ms cubic-bezier(.22,.61,.36,1) forwards}',
      // Like-count flash to brand color when tapped
      '@keyframes _btgv_count_flash{0%{color:#fff}30%{color:#F72585;transform:scale(1.18)}100%{color:#fff;transform:scale(1)}}',
      '._btgv_count_flash{display:inline-block;animation:_btgv_count_flash 600ms ease-out}',

      // ─── Multi-product horizontal strip (when 2+ tagged) ────────────────
      '._btgv_pstrip{display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;padding:4px 0 6px;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;scrollbar-width:none}',
      '._btgv_pstrip::-webkit-scrollbar{display:none}',
      '._btgv_pstrip_card{flex:0 0 auto;width:148px;background:rgba(255,255,255,.08);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:7px 9px 9px;display:flex;flex-direction:column;gap:5px;scroll-snap-align:start;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .15s,border-color .15s}',
      '._btgv_pstrip_card:active{transform:scale(.97)}',
      '._btgv_pstrip_card._active{border-color:rgba(247,37,133,.55);background:rgba(247,37,133,.08)}',
      '._btgv_pstrip_top{display:flex;gap:8px;align-items:center}',
      '._btgv_pstrip_img{width:36px;height:36px;border-radius:8px;object-fit:cover;background:#222;flex-shrink:0}',
      '._btgv_pstrip_name{font-size:11px;font-weight:600;color:#fff;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '._btgv_pstrip_price{display:flex;align-items:baseline;gap:5px;font-size:11px}',
      '._btgv_pstrip_now{color:#fff;font-weight:800}',
      '._btgv_pstrip_was{color:rgba(255,255,255,.45);text-decoration:line-through;font-size:10px}',

      // ─── Floating concierge bubble — bottom-LEFT, mirror of action rail
      // so it doesn't collide with mute. Four-corner layout: top-left brand,
      // top-right close+views, right-rail actions, bottom-left concierge,
      // bottom-center caption+CTA. ────────────────────────────────────────
      '._btgv_concbubble{position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 130px);left:14px;z-index:11;width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#ec4899);box-shadow:0 6px 22px rgba(99,102,241,.42);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;-webkit-tap-highlight-color:transparent;transition:transform .15s;overflow:visible}',
      '._btgv_concbubble:active{transform:scale(.92)}',
      '@media(min-width:640px){._btgv_concbubble{left:calc(50% - 200px)}}',
      '._btgv_concbubble img{width:100%;height:100%;border-radius:50%;object-fit:cover}',
      '@keyframes _btgv_concpulse{0%,100%{box-shadow:0 6px 22px rgba(99,102,241,.42)}50%{box-shadow:0 6px 28px rgba(99,102,241,.7),0 0 0 6px rgba(99,102,241,.18)}}',
      '._btgv_concbubble._btgv_concpulse{animation:_btgv_concpulse 1.6s ease-in-out infinite}',
      '._btgv_concbadge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ff4d6d;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(255,77,109,.4)}',

      // ─── FOMO activity toast ────────────────────────────────────────────
      '._btgv_fomo{position:absolute;top:calc(env(safe-area-inset-top,12px) + 56px);left:50%;transform:translate(-50%,-12px);z-index:9;background:rgba(0,0,0,.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);color:#fff;font-size:11.5px;font-weight:600;padding:7px 13px;border-radius:99px;display:flex;align-items:center;gap:6px;opacity:0;transition:opacity .35s ease,transform .35s ease;pointer-events:none;max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '._btgv_fomo._btgv_fomovis{opacity:1;transform:translate(-50%,0)}',


      // Product shelf in feed/story — landscape cards
      '._btgv_pshelf{position:absolute;bottom:0;left:0;right:0;z-index:8;background:linear-gradient(to top,rgba(0,0,0,.82) 0%,rgba(0,0,0,.25) 80%,transparent 100%);padding-bottom:calc(env(safe-area-inset-bottom,0px) + 10px)}',
      '@media(min-width:640px){._btgv_pshelf{max-width:420px;left:50%;transform:translateX(-50%)}}',
      '._btgv_prow{display:flex;gap:10px;padding:14px 12px 0;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
      '._btgv_prow::-webkit-scrollbar{display:none}',
      '._btgv_pcard{flex-shrink:0;width:240px;scroll-snap-align:start;background:rgba(18,18,18,.85);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.13);border-radius:16px;padding:10px 12px;display:flex;flex-direction:row;gap:10px;align-items:center}',
      '._btgv_pcard_img{width:60px;height:60px;border-radius:12px;object-fit:cover;flex-shrink:0;background:#333}',
      '._btgv_pcard_body{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}',
      '._btgv_pcard_name{color:#fff;font-size:12px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '._btgv_pcard_price{color:rgba(255,255,255,.72);font-size:11px;display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
      '._btgv_pcard_was{text-decoration:line-through;opacity:.5}',
      '._btgv_pcard_disc{background:#ff4d6d;color:#fff;font-size:8px;font-weight:700;padding:1px 4px;border-radius:4px}',
      '._btgv_pcard_actions{display:flex;gap:5px}',
      '._btgv_icon_btn{flex:1;border:none;border-radius:9px;padding:7px 3px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transition:opacity .15s;-webkit-tap-highlight-color:transparent}',
      '._btgv_icon_btn:active{opacity:.65}',
      '._btgv_icon_lbl{font-size:8px;font-weight:700;line-height:1;white-space:nowrap}',
      '._btgv_ib_cart{background:rgba(255,255,255,.18);color:#fff;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.22)}',
      '._btgv_ib_buy{background:linear-gradient(135deg,#FF6B35 0%,#F72585 100%);color:#fff;box-shadow:0 4px 14px rgba(247,37,133,.32)}',
      '._btgv_ib_neg{background:linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%);color:#fff;box-shadow:0 4px 14px rgba(247,37,133,.36)}',
      // Comments drawer — Instagram/TikTok style, fixed to viewport bottom
      '._btgv_cmt_drawer{position:fixed!important;bottom:0!important;left:0!important;right:0!important;top:auto!important;z-index:2147483647!important;background:#1c1c1e!important;border-radius:16px 16px 0 0!important;transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);max-height:75vh;display:flex;flex-direction:column;box-shadow:0 -2px 24px rgba(0,0,0,.6)!important}',
      '@media(min-width:640px){._btgv_cmt_drawer{max-width:420px!important;left:50%!important;right:auto!important;margin-left:-210px!important}}',
      '._btgv_cmt_drawer.open{transform:translateY(0)!important}',
      '._btgv_cmt_pill{width:40px;height:4px;background:rgba(255,255,255,.2);border-radius:2px;margin:10px auto 0;flex-shrink:0}',
      '._btgv_cmt_toprow{display:flex;align-items:center;justify-content:center;padding:8px 16px 12px;flex-shrink:0;position:relative;border-bottom:1px solid rgba(255,255,255,.07)}',
      '._btgv_cmt_cnt{color:#fff;font-size:14px;font-weight:600}',
      '._btgv_cmt_close{position:absolute;right:14px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.12)!important;border:none!important;color:#fff!important;width:28px;height:28px;border-radius:50%!important;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;padding:0!important;box-shadow:none!important}',
      '._btgv_cmt_list{flex:1;overflow-y:auto;padding:8px 16px 4px;display:flex;flex-direction:column}',
      '._btgv_cmt_list::-webkit-scrollbar{display:none}',
      '._btgv_cmt_item{padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05)}',
      '._btgv_cmt_item:last-child{border-bottom:none}',
      '._btgv_cmt_row{display:flex;gap:10px;align-items:flex-start}',
      '._btgv_cmt_av{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0;color:#fff}',
      '._btgv_cmt_av.customer{background:linear-gradient(135deg,#6366f1,#8b5cf6)}',
      '._btgv_cmt_av.merchant{background:linear-gradient(135deg,#ec4899,#f43f5e)}',
      '._btgv_cmt_info{flex:1;min-width:0}',
      '._btgv_cmt_nameline{display:flex;align-items:center;gap:6px;margin-bottom:2px}',
      '._btgv_cmt_name{font-size:12px;font-weight:700;color:rgba(255,255,255,.6)}',
      '._btgv_cmt_shop_badge{background:#ec4899;color:#fff;font-size:7px;font-weight:800;padding:1px 5px;border-radius:4px;letter-spacing:.04em;text-transform:uppercase}',
      '._btgv_cmt_body{font-size:14px;color:#fff;line-height:1.4;word-break:break-word;margin:0;padding:0}',
      '._btgv_cmt_time{font-size:11px;color:rgba(255,255,255,.28);margin-top:5px}',
      '._btgv_cmt_replies{padding-left:44px;margin-top:8px;display:flex;flex-direction:column;gap:10px}',
      '._btgv_cmt_empty{text-align:center;padding:40px 0 20px;color:rgba(255,255,255,.3);font-size:14px}',
      // Footer — no border, just a hairline top + safe area
      '._btgv_cmt_foot{padding:10px 14px calc(env(safe-area-inset-bottom,0px) + 10px);flex-shrink:0;border-top:1px solid rgba(255,255,255,.07)}',
      '._btgv_cmt_namewrap{margin-bottom:8px}',
      // Override ALL theme input styles with !important
      '._btgv_cmt_nameinp{display:block!important;width:100%!important;background:rgba(255,255,255,.1)!important;border:none!important;border-radius:22px!important;padding:10px 16px!important;font-size:14px!important;color:#fff!important;font-family:inherit!important;outline:none!important;box-shadow:none!important;box-sizing:border-box!important;-webkit-appearance:none!important;appearance:none!important}',
      '._btgv_cmt_nameinp::placeholder{color:rgba(255,255,255,.35)!important}',
      '._btgv_cmt_sendrow{display:flex!important;gap:10px!important;align-items:center!important}',
      '._btgv_cmt_uav{width:32px!important;height:32px!important;border-radius:50%!important;background:linear-gradient(135deg,#6366f1,#8b5cf6)!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:13px!important;font-weight:700!important;color:#fff!important;flex-shrink:0!important;border:none!important}',
      '._btgv_cmt_inp{flex:1!important;background:rgba(255,255,255,.1)!important;border:none!important;border-radius:22px!important;padding:10px 16px!important;font-size:14px!important;color:#fff!important;font-family:inherit!important;outline:none!important;box-shadow:none!important;-webkit-appearance:none!important;appearance:none!important;min-width:0!important}',
      '._btgv_cmt_inp::placeholder{color:rgba(255,255,255,.35)!important}',
      '._btgv_cmt_inp:focus{background:rgba(255,255,255,.14)!important;outline:none!important;border:none!important}',
      '._btgv_cmt_send{background:transparent!important;color:#6366f1!important;border:none!important;border-radius:0!important;padding:0!important;cursor:pointer;font-size:15px!important;font-weight:700!important;flex-shrink:0!important;white-space:nowrap!important;box-shadow:none!important;min-width:0!important;display:flex!important;align-items:center!important}',
      '._btgv_cmt_send:disabled{opacity:.3!important;cursor:default!important}',
      // View count overlay on video slide
      '._btgv_views{position:absolute;top:calc(env(safe-area-inset-top,16px) + 52px);right:12px;z-index:7;background:rgba(0,0,0,.48);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;font-size:11px;font-weight:600;display:flex;align-items:center;gap:5px;padding:4px 10px 4px 8px;border-radius:20px;pointer-events:none}',
      '._btgv_views svg{width:14px;height:14px;flex-shrink:0;opacity:.9}',
      // Floating launcher — chat bubble button with pulsating glow
      '#_btgv_launcher{position:fixed;bottom:24px;right:20px;z-index:99998;display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '#_btgv_launcher_btn{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#ec4899 100%);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;animation:_btgv_lpulse 2.2s ease-in-out infinite;box-shadow:0 4px 18px rgba(99,102,241,.55);transition:transform .15s;-webkit-tap-highlight-color:transparent;padding:0}',
      '#_btgv_launcher_btn:hover{transform:scale(1.08)}',
      '#_btgv_launcher_btn:active{transform:scale(.94);animation:none}',
      '#_btgv_launcher_btn svg{width:28px;height:28px;fill:#fff;display:block}',
      '._btgv_lbadge{position:absolute;top:-3px;right:-3px;width:14px;height:14px;background:#22c55e;border-radius:50%;border:2.5px solid #fff;animation:_btgv_cncg_pulse 2s ease-in-out infinite}',
      '#_btgv_launcher_wrap{position:relative;width:60px;height:60px}',
      '._btgv_llabel{background:rgba(15,15,25,.92);color:#fff;font-size:11px;font-weight:600;letter-spacing:.2px;padding:5px 11px;border-radius:99px;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.35);user-select:none;backdrop-filter:blur(8px)}',
      '@keyframes _btgv_lpulse{0%,100%{box-shadow:0 4px 18px rgba(99,102,241,.55),0 0 0 0 rgba(99,102,241,.4)}55%{box-shadow:0 4px 24px rgba(99,102,241,.65),0 0 0 12px rgba(99,102,241,0)}}',
      // Preview card
      '#_btgv_preview{position:fixed;bottom:100px;right:20px;z-index:99997;width:200px;border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.45);transform:translateY(16px) scale(.95);opacity:0;pointer-events:none;transition:transform .25s cubic-bezier(.34,1.56,.64,1),opacity .2s}',
      '#_btgv_preview.open{transform:translateY(0) scale(1);opacity:1;pointer-events:all}',
      '#_btgv_preview video{width:100%;height:280px;object-fit:cover;display:block}',
      '#_btgv_preview ._btgv_pv_bar{position:absolute;bottom:0;left:0;right:0;padding:12px;background:linear-gradient(transparent,rgba(0,0,0,.8));display:flex;flex-direction:column;gap:6px}',
      '#_btgv_preview ._btgv_pv_title{color:#fff;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#_btgv_preview ._btgv_pv_cta{display:flex;gap:6px}',
      '#_btgv_preview ._btgv_pv_open{flex:1;background:linear-gradient(90deg,#6366f1,#ec4899);color:#fff;font-size:11px;font-weight:700;padding:7px 0;border-radius:99px;border:none;cursor:pointer;text-align:center}',
      '#_btgv_preview ._btgv_pv_close{width:30px;height:30px;background:rgba(255,255,255,.15);border-radius:50%;border:none;color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
      // Heart particles — Facebook Live style
      '._btgv_heart{position:fixed;pointer-events:none;z-index:2147483645;line-height:1;animation:_btgv_hfall var(--dur,2.2s) cubic-bezier(.25,.46,.45,.94) forwards}',
      '@keyframes _btgv_hfall{0%{opacity:0;transform:translateY(0) translateX(0) rotate(var(--rot,0deg)) scale(.4)}10%{opacity:1}80%{opacity:.9}100%{opacity:0;transform:translateY(var(--dy,600px)) translateX(var(--dx,0px)) rotate(var(--rot2,20deg)) scale(1)}}',
      // Product card slide in vertical feed
      '._btgv_pslide_img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
      '._btgv_ppanel{position:absolute;bottom:0;left:0;right:0;padding:20px 16px calc(env(safe-area-inset-bottom,0px) + 24px);z-index:8}',
      '@media(min-width:640px){._btgv_ppanel{max-width:420px;left:50%;transform:translateX(-50%)}}',
      '._btgv_pbadge{display:inline-block;background:#ec4899;color:#fff;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;margin-bottom:8px;letter-spacing:.05em;text-transform:uppercase}',
      '._btgv_pname{color:#fff;font-size:20px;font-weight:700;line-height:1.25;margin-bottom:8px;text-shadow:0 2px 8px rgba(0,0,0,.5)}',
      '._btgv_pprrow{display:flex;align-items:center;gap:8px;margin-bottom:16px}',
      '._btgv_pprice{color:#fff;font-size:26px;font-weight:800}',
      '._btgv_pwas{color:rgba(255,255,255,.5);font-size:15px;text-decoration:line-through}',
      '._btgv_pdiscbadge{background:#ff4d6d;color:#fff;font-size:9px;font-weight:700;padding:3px 8px;border-radius:12px}',
      '._btgv_pacts{display:flex;gap:8px}',
      '._btgv_pbtn{flex:1;padding:13px 6px;border:none;border-radius:12px;font-size:11px;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;-webkit-tap-highlight-color:transparent;transition:opacity .15s}',
      '._btgv_pbtn:active{opacity:.7}',
      '._btgv_pbtn_cart{background:rgba(255,255,255,.18);color:#fff;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.25)}',
      '._btgv_pbtn_buy{background:linear-gradient(135deg,#FF6B35 0%,#F72585 100%);color:#fff;box-shadow:0 4px 14px rgba(247,37,133,.36)}',
      '._btgv_pbtn_neg{background:linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%);color:#fff;box-shadow:0 4px 14px rgba(247,37,133,.4)}',

      // ─── Concierge chat ───────────────────────────────────────────────────────
      // Widget window — portrait ratio (taller than wide) on all screen sizes
      '#_btgv_cncg{position:fixed;bottom:16px;right:16px;z-index:99997;width:360px;height:min(640px,calc(100svh - 100px));background:#0c0c14;border-radius:20px;border:1px solid rgba(255,255,255,.06);box-shadow:0 24px 60px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.04);font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;overflow:hidden;transform:translateY(20px) scale(0.96);opacity:0;pointer-events:none;transition:transform .3s cubic-bezier(.34,1.56,.64,1),opacity .22s ease,box-shadow .35s ease}',
      '#_btgv_cncg.open{transform:translateY(0) scale(1);opacity:1;pointer-events:all}',
      // ─── Negotiation mode (Slice D) — bold visual when haggle is live ─────
      '#_btgv_cncg.negotiating{animation:_btgv_neg_glow 2.4s ease-in-out infinite}',
      '@keyframes _btgv_neg_glow{0%,100%{box-shadow:0 24px 60px rgba(0,0,0,.65),0 0 0 2px rgba(245,158,11,0.4),inset 0 0 0 1px rgba(245,158,11,0.18)}50%{box-shadow:0 24px 60px rgba(0,0,0,.65),0 0 0 3px rgba(245,158,11,0.7),inset 0 0 0 1px rgba(245,158,11,0.32)}}',
      '#_btgv_cncg.negotiating ._btgv_cncg_msgs{background:linear-gradient(180deg,rgba(245,158,11,0.08) 0%,rgba(245,158,11,0.02) 100%)}',
      '#_btgv_cncg.negotiating ._btgv_cncg_shim{background:linear-gradient(90deg,#f59e0b,#f97316,#ec4899,#f59e0b);background-size:200% 100%;animation:_btgv_cncg_shim 1.6s linear infinite}',
      '#_btgv_cncg.negotiating ._btgv_cncg_title{background:linear-gradient(135deg,#fbbf24,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}',
      '._btgv_neg_pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;background:rgba(245,158,11,0.18);color:#fbbf24;padding:2px 8px;border-radius:10px;margin-left:6px;font-weight:600;animation:_btgv_neg_pulse 2s ease-in-out infinite}',
      '@keyframes _btgv_neg_pulse{0%,100%{transform:scale(1);opacity:.95}50%{transform:scale(1.04);opacity:1}}',
      // ─── Offer card (Slice E) ────────────────────────────────────────────
      '._btgv_offercard{align-self:flex-start;width:88%;max-width:300px;background:linear-gradient(160deg,rgba(245,158,11,0.16),rgba(236,72,153,0.10));border:1px solid rgba(245,158,11,0.32);border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;box-shadow:0 6px 18px rgba(245,158,11,0.18)}',
      '._btgv_offercard_hdr{display:flex;gap:10px;align-items:center}',
      '._btgv_offercard_img{width:48px;height:48px;border-radius:10px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,.08)}',
      '._btgv_offercard_info{flex:1;min-width:0}',
      '._btgv_offercard_label{font-size:10px;color:#fbbf24;font-weight:700;letter-spacing:.04em;text-transform:uppercase}',
      '._btgv_offercard_name{font-size:12px;color:#fff;font-weight:600;line-height:1.3;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '._btgv_offercard_pricerow{display:flex;align-items:baseline;gap:8px}',
      '._btgv_offercard_now{font-size:24px;color:#fff;font-weight:800;line-height:1}',
      '._btgv_offercard_was{font-size:13px;color:rgba(255,255,255,.45);text-decoration:line-through}',
      '._btgv_offercard_save{font-size:11px;color:#34d399;font-weight:700;background:rgba(52,211,153,0.14);padding:2px 8px;border-radius:6px}',
      '._btgv_offercard_meta{font-size:10px;color:rgba(255,255,255,.5)}',
      // ─── Polished negotiation chips (Slice F) ────────────────────────────
      '._btgv_negochips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 4px 0}',
      '._btgv_negochip_accept{background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:9px 16px;border-radius:18px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(16,185,129,0.35);transition:transform .12s}',
      '._btgv_negochip_accept:active{transform:scale(.97)}',
      '._btgv_negochip_counter{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.18);padding:9px 14px;border-radius:18px;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s}',
      '._btgv_negochip_counter:hover{background:rgba(255,255,255,.14)}',
      '._btgv_negochip_pass{background:transparent;color:rgba(255,255,255,.5);border:none;padding:9px 12px;border-radius:18px;font-size:11px;font-weight:500;cursor:pointer}',
      '._btgv_negochip_pass:hover{color:#fff}',
      // ─── Page-level celebration (Slice H) ────────────────────────────────
      '#_btgv_pagewin{position:fixed;inset:0;z-index:2147483647;background:radial-gradient(circle at center,rgba(0,0,0,.86),rgba(0,0,0,.95));display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .4s ease;pointer-events:none}',
      '#_btgv_pagewin.show{opacity:1;pointer-events:all}',
      '._btgv_pagewin_card{text-align:center;color:#fff;padding:32px 40px;display:flex;flex-direction:column;align-items:center;gap:14px;transform:scale(.85);transition:transform .55s cubic-bezier(.34,1.56,.64,1)}',
      '#_btgv_pagewin.show ._btgv_pagewin_card{transform:scale(1)}',
      '._btgv_pagewin_emoji{font-size:72px;animation:_btgv_pw_bounce .7s cubic-bezier(.34,1.56,.64,1)}',
      '@keyframes _btgv_pw_bounce{0%{transform:scale(0);opacity:0}60%{transform:scale(1.18);opacity:1}100%{transform:scale(1)}}',
      '._btgv_pagewin_label{font-size:14px;color:#fbbf24;font-weight:700;letter-spacing:.18em;text-transform:uppercase}',
      '._btgv_pagewin_price{font-size:72px;font-weight:900;line-height:1;background:linear-gradient(135deg,#fbbf24,#fb7185,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}',
      '._btgv_pagewin_sub{font-size:13px;color:rgba(255,255,255,.7);margin-top:2px}',
      '._btgv_pagewin_code{font-family:monospace;font-size:11px;color:rgba(255,255,255,.85);background:rgba(255,255,255,.08);padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.14);letter-spacing:.1em;margin-top:6px}',
      '#_btgv_cncg ._btgv_cncg_msgs{flex:1;overflow-y:auto;overflow-x:hidden;padding:14px 12px 8px;display:flex;flex-direction:column;gap:9px;min-height:0;scrollbar-width:none}',
      // expanded: wider but still portrait
      '#_btgv_cncg.expanded{width:min(420px,calc(100vw - 32px));height:min(720px,calc(100svh - 40px))}',
      // fullscreen
      '#_btgv_cncg.fullscreen{inset:0;width:100vw;height:100svh;border-radius:0;transition:none}',
      '@media(max-width:440px){#_btgv_cncg{width:calc(100vw - 16px);right:8px;bottom:8px;height:min(640px,calc(100svh - 80px));border-radius:16px}}',
      '._btgv_cncg_expand{width:26px;height:26px;border:none;background:rgba(255,255,255,.07);border-radius:50%;color:rgba(255,255,255,.45);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;margin-right:2px}',
      '._btgv_cncg_expand:hover{background:rgba(255,255,255,.13)}',
      // shimmer
      '._btgv_cncg_shim{height:3px;background:linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899,#f59e0b,#6366f1);background-size:200% 100%;animation:_btgv_cncg_shim 2.5s linear infinite;flex-shrink:0}',
      '@keyframes _btgv_cncg_shim{0%{background-position:0% 0%}100%{background-position:200% 0%}}',
      // header
      '._btgv_cncg_hdr{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0;background:var(--btgv-header-bg,transparent);color:var(--btgv-header-text,#fff)}',
      '._btgv_cncg_av{width:36px;height:36px;border-radius:50%;background:var(--btgv-primary,linear-gradient(135deg,#6366f1,#ec4899));display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--btgv-primary-text,#fff);flex-shrink:0;position:relative;overflow:hidden}',
      '._btgv_cncg_av img{width:100%;height:100%;object-fit:cover;border-radius:50%}',
      '._btgv_cncg_dot{position:absolute;bottom:0;right:0;width:9px;height:9px;background:#22c55e;border-radius:50%;border:2px solid #0c0c14;animation:_btgv_cncg_pulse 2s ease-in-out infinite}',
      '@keyframes _btgv_cncg_pulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.45)}50%{box-shadow:0 0 0 4px rgba(34,197,94,0)}}',
      '._btgv_cncg_namecol{flex:1;min-width:0}',
      '._btgv_cncg_title{color:#fff;font-size:13px;font-weight:700}',
      '._btgv_cncg_sub{color:rgba(255,255,255,.38);font-size:10px;margin-top:1px}',
      '._btgv_cncg_x{width:26px;height:26px;border:none;background:rgba(255,255,255,.07);border-radius:50%;color:rgba(255,255,255,.45);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}',
      // messages area — fills remaining widget height, no min/max (widget height controls portrait ratio)
      '._btgv_cncg_msgs::-webkit-scrollbar{display:none}',
      // bubbles
      '._btgv_cncg_bot{align-self:flex-start;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);color:#fff;font-size:13px;line-height:1.55;padding:10px 13px;border-radius:16px 16px 16px 4px;max-width:88%}',
      '._btgv_cncg_usr{align-self:flex-end;background:var(--btgv-primary,linear-gradient(135deg,#6366f1,#8b5cf6));color:var(--btgv-primary-text,#fff);font-size:13px;line-height:1.55;padding:10px 13px;border-radius:16px 16px 4px 16px;max-width:88%}',
      // typing indicator
      '._btgv_cncg_typing{align-self:flex-start;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);padding:10px 14px;border-radius:16px 16px 16px 4px;display:flex;flex-direction:column;gap:6px;min-width:140px}',
      '._btgv_cncg_typing_dots{display:flex;align-items:center;gap:5px}',
      '._btgv_cncg_typing_dots span{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.4);animation:_btgv_cncg_bounce 1.4s ease-in-out infinite}',
      '._btgv_cncg_typing_dots span:nth-child(2){animation-delay:.16s}',
      '._btgv_cncg_typing_dots span:nth-child(3){animation-delay:.32s}',
      '@keyframes_btgv_cncg_bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-7px)}}',
      '@keyframes _btgv_cncg_bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-7px)}}',
      '._btgv_cncg_typing_hint{color:rgba(255,255,255,.5);font-size:10px;font-style:italic;transition:opacity .3s}',
      // quick-action chips
      '._btgv_cncg_chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 0 2px}',
      '._btgv_cncg_chip{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.82);font-size:12px;font-weight:500;padding:6px 12px;border-radius:99px;cursor:pointer;white-space:nowrap;font-family:inherit;-webkit-tap-highlight-color:transparent;transition:background .15s,border-color .15s}',
      '._btgv_cncg_chip:active{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.25)}',
      // Inline variant picker (REP-style)
      '._btgv_cncg_vpicker{display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;padding:6px 4px 10px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;width:100%;box-sizing:border-box;align-self:stretch}',
      '._btgv_cncg_vpicker::-webkit-scrollbar{display:none}',
      '._btgv_cncg_vpickeritem{flex:0 0 130px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:0;cursor:pointer;color:#fff;font-family:inherit;display:flex;flex-direction:column;overflow:hidden;-webkit-tap-highlight-color:transparent;transition:transform .15s,border-color .15s;scroll-snap-align:start}',
      '._btgv_cncg_vpickeritem:active{transform:scale(.97);border-color:var(--btgv-primary,rgba(99,102,241,.6))}',
      '._btgv_cncg_vpicker_img{position:relative;width:100%;height:130px;background:#111;overflow:hidden}',
      '._btgv_cncg_vpicker_img img{width:100%;height:100%;object-fit:cover;display:block}',
      '._btgv_cncg_vpicker_t{font-size:12px;font-weight:600;padding:8px 10px 0;text-align:left}',
      '._btgv_cncg_vpicker_p{font-size:13px;font-weight:700;padding:2px 10px 10px;color:rgba(255,255,255,.85);text-align:left}',
      // video carousel (inline in chat)
      '._btgv_cncg_vcarouselw{position:relative;width:100%;padding:0 4px;box-sizing:border-box}',
      '._btgv_cncg_vcarousel{display:flex;gap:12px;overflow-x:auto;overflow-y:hidden;padding:2px 4px 10px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;width:100%;box-sizing:border-box}',
      '._btgv_cncg_vcarousel::-webkit-scrollbar{display:none}',
      // tile: fixed 220px wide so height (300px) > width → always portrait on any screen
      '._btgv_cncg_vtile{flex-shrink:0;width:calc(100% - 32px);border-radius:16px;overflow:hidden;position:relative;background:#111;-webkit-tap-highlight-color:transparent;scroll-snap-align:start;cursor:pointer}',
      '._btgv_cncg_vtile_media{position:relative;width:100%;height:380px;overflow:hidden}',
      '._btgv_cncg_vtile_media video,._btgv_cncg_vtile_media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
      '._btgv_cncg_vtile_ov{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.88) 0%,rgba(0,0,0,.1) 50%,rgba(0,0,0,.25) 100%)}',
      // views — top left
      '._btgv_cncg_vtile_views{position:absolute;top:8px;left:10px;display:flex;align-items:center;gap:3px;color:#fff;font-size:10px;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,.6)}',
      '._btgv_cncg_vtile_views svg{width:12px;height:12px;opacity:.9}',
      // right rail — likes, comments, share (vertically stacked, anchored to bottom of media)
      '._btgv_cncg_vtile_rail{position:absolute;right:8px;bottom:52px;display:flex;flex-direction:column;align-items:center;gap:10px}',
      '._btgv_cncg_vtile_action{display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '._btgv_cncg_vtile_action_ic{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.18);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-size:15px}',
      '._btgv_cncg_vtile_action_lbl{color:#fff;font-size:9px;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.7)}',
      // title at bottom-left of media (leaves room for rail on right)
      '._btgv_cncg_vtile_foot{position:absolute;bottom:0;left:0;right:48px;padding:10px 10px 12px;display:flex;flex-direction:column;gap:0}',
      '._btgv_cncg_vtile_title{color:#fff;font-size:11px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 1px 4px rgba(0,0,0,.6)}',
      // white CTA panel below the video
      '._btgv_cncg_vtile_panel{background:#fff;padding:8px 10px 10px;display:flex;flex-direction:column;gap:5px}',
      '._btgv_cncg_vtile_prow{display:flex;gap:5px}',
      '._btgv_cncg_vtile_pcart{flex:1;background:#111;border:none;border-radius:8px;color:#fff;font-size:10px;font-weight:700;padding:8px 3px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;text-align:center;white-space:nowrap}',
      '._btgv_cncg_vtile_pbuy{flex:1;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:8px;color:#fff;font-size:10px;font-weight:700;padding:8px 3px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;text-align:center;white-space:nowrap}',
      '._btgv_cncg_vtile_pneg{width:100%;background:rgba(236,72,153,.9);border:none;border-radius:8px;color:#fff;font-size:10px;font-weight:700;padding:7px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;text-align:center}',
      '._btgv_cncg_vtile_title{position:absolute;bottom:0;left:0;right:0;padding:4px 6px;color:#fff;font-size:9px;font-weight:600;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // product card carousel — portrait cards, scroll-snap, arrow nav
      '._btgv_cncg_pcardsw{position:relative;width:100%;padding:0;box-sizing:border-box}',
      '._btgv_cncg_pcards{display:flex;gap:12px;overflow-x:auto;overflow-y:visible;padding:4px 4px 12px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;width:100%;box-sizing:border-box}',
      '._btgv_cncg_pcards::-webkit-scrollbar{display:none}',
      '._btgv_cncg_pcard{flex-shrink:0;width:calc(100% - 32px);background:#fff;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;scroll-snap-align:start;box-shadow:0 6px 24px rgba(0,0,0,.18);position:relative;cursor:pointer}',
      '._btgv_cncg_pcard_img{width:100%;height:300px;object-fit:cover;object-position:50% 20%;display:block;background:#f3f4f6;flex-shrink:0}',
      '._btgv_cncg_pcard_body{padding:10px 10px 12px;display:flex;flex-direction:column;gap:4px;background:#fff}',
      '._btgv_cncg_pcard_nm{color:#111;font-size:12px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '._btgv_cncg_pcard_pr{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '._btgv_cncg_pcard_price{color:#111;font-size:14px;font-weight:800}',
      '._btgv_cncg_pcard_was{color:#aaa;font-size:11px;text-decoration:line-through}',
      '._btgv_cncg_pcard_badge{background:#ff4d6d;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:99px}',
      // CTA buttons — compact so all fit without scrolling
      '._btgv_cncg_pcard_btns{display:flex;flex-direction:column;gap:6px;margin-top:6px}',
      '._btgv_cncg_pcard_row{display:flex;gap:6px}',
      '._btgv_cncg_pcard_cart{flex:1;background:#111;border:none;border-radius:9px;color:#fff;font-size:11px;font-weight:700;padding:9px 3px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;transition:background .15s;text-align:center;white-space:nowrap}',
      '._btgv_cncg_pcard_cart:active{background:#333}',
      '._btgv_cncg_pcard_buy{flex:1;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:9px;color:#fff;font-size:11px;font-weight:700;padding:9px 3px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;text-align:center;white-space:nowrap}',
      '._btgv_cncg_pcard_neg{width:100%;background:rgba(236,72,153,.9);border:none;border-radius:9px;color:#fff;font-size:11px;font-weight:700;padding:8px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;text-align:center}',
      // scroll arrow buttons
      '._btgv_cncg_pscrl{position:absolute;top:38%;transform:translateY(-50%);width:30px;height:30px;border-radius:50%;background:#fff;border:none;box-shadow:0 2px 10px rgba(0,0,0,.28);cursor:pointer;z-index:6;font-size:15px;display:flex;align-items:center;justify-content:center;color:#111;-webkit-tap-highlight-color:transparent;padding:0;line-height:1}',
      '._btgv_cncg_pscrl_l{left:-6px}',
      '._btgv_cncg_pscrl_r{right:-6px}',
      // post-add strip
      '._btgv_cncg_carted{display:flex;gap:6px;align-items:center;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);border-radius:9px;padding:9px 11px}',
      '._btgv_cncg_carted_msg{flex:1;color:#16a34a;font-size:11px;font-weight:700}',
      '._btgv_cncg_carted_view{background:#111;border:none;border-radius:7px;color:#fff;font-size:10px;font-weight:700;padding:5px 10px;cursor:pointer;font-family:inherit;white-space:nowrap}',
      '._btgv_cncg_carted_chk{background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:7px;color:#fff;font-size:10px;font-weight:700;padding:5px 10px;cursor:pointer;font-family:inherit;white-space:nowrap}',
      // hamburger nav menu
      '._btgv_cncg_menubtn{width:28px;height:28px;border:none;background:rgba(255,255,255,.07);border-radius:8px;color:rgba(255,255,255,.55);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;position:relative}',
      '._btgv_cncg_menupanel{position:absolute;top:58px;left:0;right:0;background:#16161f;border-bottom:1px solid rgba(255,255,255,.07);z-index:10;display:none;flex-direction:column;padding:6px 0}',
      '._btgv_cncg_menupanel.open{display:flex}',
      '._btgv_cncg_menuitem{display:flex;align-items:center;gap:10px;padding:11px 16px;color:rgba(255,255,255,.78);font-size:13px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .12s}',
      '._btgv_cncg_menuitem:active{background:rgba(255,255,255,.06)}',
      '._btgv_cncg_menuitem_icon{font-size:15px;width:20px;text-align:center;flex-shrink:0}',
      // order status card
      '._btgv_cncg_order{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:13px 14px;display:flex;flex-direction:column;gap:7px;width:100%}',
      '._btgv_cncg_order_hd{display:flex;justify-content:space-between;align-items:center}',
      '._btgv_cncg_order_nm{color:#fff;font-size:13px;font-weight:700}',
      '._btgv_cncg_order_status{font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px}',
      '._btgv_cncg_order_row{display:flex;justify-content:space-between;color:rgba(255,255,255,.55);font-size:11px}',
      '._btgv_cncg_order_track{display:flex;flex-direction:column;gap:6px;margin-top:2px}',
      '._btgv_cncg_order_inp{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:8px 11px;font-size:12px;color:#fff;font-family:inherit;outline:none;width:100%;box-sizing:border-box;-webkit-appearance:none}',
      '._btgv_cncg_order_inp::placeholder{color:rgba(255,255,255,.28)}',
      '._btgv_cncg_order_submit{background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:9px;color:#fff;font-size:12px;font-weight:700;padding:9px;cursor:pointer;font-family:inherit;width:100%}',
      // collection carousel (inline in chat)
      '._btgv_cncg_ccarousel{display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;padding:2px 0 6px;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
      '._btgv_cncg_ccarousel::-webkit-scrollbar{display:none}',
      '._btgv_cncg_ctile{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '._btgv_cncg_ctile_ring{width:62px;height:62px;border-radius:50%;padding:2.5px;background:linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%);transition:transform .15s}',
      '._btgv_cncg_ctile:active ._btgv_cncg_ctile_ring{transform:scale(.9)}',
      '._btgv_cncg_ctile_inner{width:100%;height:100%;border-radius:50%;overflow:hidden;border:2.5px solid #0c0c14;background:#1a1a2e;display:flex;align-items:center;justify-content:center;font-size:18px}',
      '._btgv_cncg_ctile_inner img{width:100%;height:100%;object-fit:cover}',
      '._btgv_cncg_ctile_nm{color:rgba(255,255,255,.72);font-size:9px;font-weight:600;text-align:center;max-width:66px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // input row (always visible)
      '._btgv_cncg_inputrow{display:flex;align-items:center;gap:8px;padding:9px 12px calc(env(safe-area-inset-bottom,0px) + 11px);border-top:1px solid rgba(255,255,255,.05);flex-shrink:0}',
      '._btgv_cncg_inp{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:9px 13px;font-size:13px;color:#fff;font-family:inherit;outline:none;min-width:0;-webkit-appearance:none;appearance:none}',
      '._btgv_cncg_inp::placeholder{color:rgba(255,255,255,.28)}',
      '._btgv_cncg_inp:focus{border-color:rgba(99,102,241,.5);background:rgba(255,255,255,.08);outline:none}',
      '._btgv_cncg_send{width:34px;height:34px;border:none;border-radius:50%;background:var(--btgv-primary,linear-gradient(135deg,#6366f1,#ec4899));color:var(--btgv-primary-text,#fff);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s}',
      '._btgv_cncg_send:disabled{opacity:.35;cursor:default}',
      // negotiated cart deal cards
      '._btgv_neg_cart{display:flex;flex-direction:column;gap:8px;width:100%;margin:4px 0}',
      '._btgv_neg_cart_card{display:flex;align-items:center;background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.2);border-radius:12px;padding:10px 12px;gap:8px}',
      '._btgv_neg_cart_info{flex:1;min-width:0}',
      '._btgv_neg_cart_name{color:#fff;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}',
      '._btgv_neg_cart_price{display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
      '._btgv_neg_cart_deal{color:#22c55e;font-size:14px;font-weight:800}',
      '._btgv_neg_cart_orig{color:rgba(255,255,255,.35);font-size:11px;text-decoration:line-through}',
      '._btgv_neg_cart_badge{background:rgba(34,197,94,.18);color:#22c55e;font-size:9px;font-weight:700;padding:2px 6px;border-radius:99px;white-space:nowrap}',
      '._btgv_neg_cart_rm{background:none;border:1px solid rgba(255,255,255,.15);border-radius:8px;color:rgba(255,255,255,.4);cursor:pointer;font-size:12px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;font-family:inherit}',
      '._btgv_neg_cart_rm:hover{border-color:rgba(239,68,68,.5);color:#ef4444}',
      '._btgv_neg_cart_checkout{width:100%;background:linear-gradient(135deg,#22c55e,#16a34a);border:none;border-radius:12px;color:#fff;font-size:13px;font-weight:700;padding:13px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;text-align:center}',
      '._btgv_neg_cart_checkout:active{opacity:.85}',
    ].join('');
    document.head.appendChild(s);
  }

  // Filename patterns from cameras / phones get used as title when there
  // was no real caption. Drop them so we don't show "MVI_2026-04-30" as
  // the video description.
  function _btgvCleanTitle(t) {
    if (!t) return null;
    var s = String(t).trim();
    if (!s) return null;
    // Pure filename patterns
    if (/^(MVI|IMG|VID|DSC|DSCN|PXL|GOPR)[_-]?\d/i.test(s)) return null;
    // Trailing file extension
    if (/\.(mp4|mov|m4v|avi|webm|mkv|3gp|wmv|flv)$/i.test(s)) {
      s = s.replace(/\.(mp4|mov|m4v|avi|webm|mkv|3gp|wmv|flv)$/i, '');
    }
    // ISO-date-only or pure-number titles aren't meaningful descriptions
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    if (/^\d+$/.test(s)) return null;
    return s.length >= 3 ? s : null;
  }

  // ─── New compact bottom zone — caption + price + primary CTA ─────────────
  // Replaces the old buildProductShelf for the customer-facing feed.
  // - 1 tagged product → title (if real) / price-pill / primary "Make an offer" CTA
  // - 2+ tagged products → title / horizontal product strip + tap-to-switch
  // Brand handle is NOT shown here — it's already on the top-left badge.
  function buildBottomZone(vid, tags, context) {
    var zone = document.createElement('div');
    zone.className = '_btgv_bzone';

    // Title — only if it's a real caption, not a filename pattern
    var cleanedTitle = _btgvCleanTitle(vid.title);
    if (cleanedTitle) {
      var captext = document.createElement('div');
      captext.className = '_btgv_captext';
      captext.textContent = cleanedTitle;
      captext.onclick = function (e) {
        e.stopPropagation();
        captext.classList.toggle('_btgv_capexpand');
      };
      zone.appendChild(captext);
    }

    if (!tags || !tags.length) {
      // No products tagged — show a gentle empty state instead of a void
      var empty = document.createElement('div');
      empty.style.cssText = 'color:rgba(255,255,255,.55);font-size:11px;padding:6px 0';
      empty.textContent = 'No products in this video yet';
      zone.appendChild(empty);
      return zone;
    }

    // Multi-product horizontal strip
    if (tags.length > 1) {
      var strip = document.createElement('div');
      strip.className = '_btgv_pstrip';
      tags.forEach(function (tag, i) {
        var card = document.createElement('div');
        card.className = '_btgv_pstrip_card' + (i === 0 ? ' _active' : '');
        var top = document.createElement('div'); top.className = '_btgv_pstrip_top';
        if (tag.image_url) {
          var img = document.createElement('img'); img.className = '_btgv_pstrip_img'; img.src = tag.image_url;
          top.appendChild(img);
        }
        var name = document.createElement('div'); name.className = '_btgv_pstrip_name'; name.textContent = tag.product_name;
        top.appendChild(name);
        card.appendChild(top);
        var pr = parseFloat(tag.price || 0);
        var was = parseFloat(tag.compare_at_price || 0);
        if (pr > 0) {
          var prL = document.createElement('div'); prL.className = '_btgv_pstrip_price';
          var pn = document.createElement('span'); pn.className = '_btgv_pstrip_now'; pn.textContent = '$' + pr.toFixed(2);
          prL.appendChild(pn);
          if (was > pr) {
            var pw = document.createElement('span'); pw.className = '_btgv_pstrip_was'; pw.textContent = '$' + was.toFixed(2);
            prL.appendChild(pw);
          }
          card.appendChild(prL);
        }
        card.onclick = function () {
          // Switch active card + repaint the price line + CTA below
          strip.querySelectorAll('._btgv_pstrip_card').forEach(function (el) { el.classList.remove('_active'); });
          card.classList.add('_active');
          renderPriceAndCTA(zone, vid, tag, context);
        };
        strip.appendChild(card);
      });
      zone.appendChild(strip);
    }

    // Price line + primary CTA — drives off the active tag (first by default)
    renderPriceAndCTA(zone, vid, tags[0], context);

    return zone;
  }

  // Renders or replaces the price-line + CTA-row inside an existing zone
  // for the given active tag. Called on initial build + on strip-card switch.
  function renderPriceAndCTA(zone, vid, tag, context) {
    // Strip any existing price-line + cta-row first
    zone.querySelectorAll('._btgv_priceline, ._btgv_ctarow').forEach(function (el) { el.remove(); });

    var priceLine = document.createElement('div');
    priceLine.className = '_btgv_priceline';
    var pr = parseFloat(tag.price || 0);
    var was = parseFloat(tag.compare_at_price || 0);
    if (pr > 0) {
      var now = document.createElement('span'); now.className = '_btgv_price_now'; now.textContent = '$' + pr.toFixed(2);
      priceLine.appendChild(now);
      if (was > pr) {
        var w = document.createElement('span'); w.className = '_btgv_price_was'; w.textContent = '$' + was.toFixed(2);
        var d = document.createElement('span'); d.className = '_btgv_price_disc'; d.textContent = Math.round((1 - pr / was) * 100) + '% OFF';
        priceLine.appendChild(w); priceLine.appendChild(d);
      }
    }
    zone.appendChild(priceLine);
    // Note: removed the inline "most pay" hint — the CTA below already
    // carries the negotiability signal ("Make an offer · usually $X-Y")
    // and showing it twice on adjacent lines reads as repetitive.

    // CTA row: primary Negotiate (full-width gradient) + small Cart + Buy icons
    var ctaRow = document.createElement('div');
    ctaRow.className = '_btgv_ctarow';

    var negBtn = document.createElement('button');
    negBtn.className = '_btgv_cta_neg';
    // Copy: "Make an offer · usually $X-Y" telegraphs the realistic floor
    // range, not just "save up to" (which can feel hypothetical). Pulls
    // from merchant_settings.max_discount_pct so the range is grounded.
    var maxDiscPct = context.maxDiscount || 20;
    var lowEnd = Math.max(1, Math.round(pr * (1 - maxDiscPct / 100)));
    var highEnd = Math.max(lowEnd + 1, Math.round(pr - 1));
    negBtn.innerHTML = '<span style="font-size:16px">🤝</span><span>Make an offer · usually $' + lowEnd + '–' + highEnd + '</span>';
    negBtn.onclick = function (e) {
      e.stopPropagation();
      track(vid.id, 'negotiate', tag.shopify_product_id);
      pauseFeedForAction();
      _btgvStartChatNegotiation(tag);
    };
    ctaRow.appendChild(negBtn);

    var cartBtn = document.createElement('button');
    cartBtn.className = '_btgv_cta_inline _btgv_cta_cart';
    cartBtn.innerHTML = '🛒';
    cartBtn.title = 'Add to cart';
    cartBtn.onclick = function (e) {
      e.stopPropagation();
      track(vid.id, 'add_to_cart', tag.shopify_product_id);
      pauseFeedForAction();
      addToCart(tag.shopify_variant_id, function (ok) {
        fireConfetti();
        if (ok) {
          cartBtn.innerHTML = '✓';
          setTimeout(function () { cartBtn.innerHTML = '🛒'; }, 2200);
        }
        resumeFeedAfterAction();
      });
    };
    ctaRow.appendChild(cartBtn);

    var buyBtn = document.createElement('button');
    buyBtn.className = '_btgv_cta_inline _btgv_cta_buy';
    buyBtn.innerHTML = '⚡';
    buyBtn.title = 'Buy now';
    buyBtn.onclick = function (e) {
      e.stopPropagation();
      track(vid.id, 'add_to_cart', tag.shopify_product_id);
      pauseFeedForAction();
      addToCart(tag.shopify_variant_id, function (ok) {
        if (ok) { fireConfetti(); window.location.href = '/checkout'; }
        else { resumeFeedAfterAction(); }
      });
    };
    ctaRow.appendChild(buyBtn);

    zone.appendChild(ctaRow);
  }

  // ─── Top bar: brand badge + view count grouped on the left,
  // close button stays at top-right (handled by global #_btgv_close) ──
  function buildTopBar(vid, context) {
    var bar = document.createElement('div');
    bar.className = '_btgv_topbar';

    // Left group: brand badge + view count (kept tight together per
    // merchant feedback — easier to scan than splitting them across
    // opposite ends of the screen).
    var left = document.createElement('div');
    left.style.cssText = 'display:flex;align-items:center;gap:8px;pointer-events:auto';

    var brand = document.createElement('a');
    brand.className = '_btgv_brand';
    brand.href = context.brandUrl || '#';
    if (context.brandUrl) brand.target = '_blank';
    brand.rel = 'noopener noreferrer';
    var logo = document.createElement('div');
    logo.className = '_btgv_brand_logo';
    if (context.brandLogo) {
      var img = document.createElement('img');
      img.src = context.brandLogo;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      logo.appendChild(img);
    } else {
      logo.textContent = (context.brandName || 'Shop').charAt(0).toUpperCase();
    }
    var nameEl = document.createElement('span');
    nameEl.className = '_btgv_brand_name';
    nameEl.textContent = context.brandName || 'Shop';
    brand.appendChild(logo); brand.appendChild(nameEl);
    left.appendChild(brand);

    // View count pill — sits right next to the brand badge so it reads
    // as part of the same identity unit. Empty pill if 0 views (no UI noise).
    var vc = vid.views_count || 0;
    if (vc > 0) {
      var views = document.createElement('div');
      views.className = '_btgv_views';
      views.style.cssText = 'position:static;top:auto;right:auto';
      views.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>' + fmtCount(vc) + '</span>';
      left.appendChild(views);
    }

    bar.appendChild(left);
    return bar;
  }

  // ─── Floating concierge bubble — opens chat with source-video context ──
  function buildConciergeBubbleInFeed(context) {
    var btn = document.createElement('button');
    btn.className = '_btgv_concbubble';
    if (context.botAvatar) {
      var img = document.createElement('img'); img.src = context.botAvatar; img.alt = '';
      btn.appendChild(img);
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    }
    // Soft pulse after 8s of dwell to invite engagement
    setTimeout(function () { btn.classList.add('_btgv_concpulse'); }, 8000);
    btn.onclick = function (e) {
      e.stopPropagation();
      btn.classList.remove('_btgv_concpulse');
      // Open the existing concierge chat surface — already wired via openConcierge
      try { if (typeof openConcierge === 'function') openConcierge(); } catch (_) {}
    };
    return btn;
  }

  // ─── FOMO toast cycle: fades real recent-activity strings in/out ────────
  function buildFomoSystem(feedEl, apiKey) {
    var toast = document.createElement('div');
    toast.className = '_btgv_fomo';
    feedEl.appendChild(toast);

    var messages = [];
    var idx = 0;
    var timer = null;

    function show(msg) {
      toast.textContent = msg;
      toast.classList.add('_btgv_fomovis');
      setTimeout(function () { toast.classList.remove('_btgv_fomovis'); }, 4200);
    }

    function cycle() {
      if (!messages.length) return;
      show(messages[idx % messages.length]);
      idx++;
    }

    // Pull real activity (anonymized recent deals/sales) on mount
    fetch(API_BASE + '/api/widget/recent-activity?k=' + encodeURIComponent(apiKey))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && Array.isArray(d.messages) && d.messages.length) {
          messages = d.messages;
          // First toast at 6s in (let the user start watching first)
          setTimeout(cycle, 6000);
          // Then every ~38s
          timer = setInterval(cycle, 38000);
        }
      })
      .catch(function () {});

    return {
      destroy: function () {
        if (timer) clearInterval(timer);
        toast.remove();
      },
    };
  }

  // ─── Double-tap to like + heart burst at tap point (Insta pattern) ──────
  // Also handles single tap → pause/play. We wait 320ms after a tap to see
  // if a second tap comes; if not, treat as single tap (pause/play with a
  // brief icon overlay). If a second tap arrives within the window, like.
  function attachDoubleTapToLike(slideEl, onLike) {
    var lastTapAt = 0;
    var lastTapX = 0;
    var lastTapY = 0;
    var pendingSingle = null;
    slideEl.addEventListener('click', function (e) {
      // Don't intercept clicks on rail/CTA/etc — only direct video taps
      if (e.target.closest('._btgv_rail, ._btgv_bzone, ._btgv_topbar, ._btgv_pshelf, ._btgv_concbubble, ._btgv_brand')) return;
      var now = Date.now();
      if (now - lastTapAt < 320 && Math.abs(e.clientX - lastTapX) < 40 && Math.abs(e.clientY - lastTapY) < 40) {
        // Double tap — cancel any pending single-tap pause + fire like burst
        if (pendingSingle) { clearTimeout(pendingSingle); pendingSingle = null; }
        spawnDoubleTapHeart(slideEl, e.clientX, e.clientY);
        if (typeof onLike === 'function') onLike();
        lastTapAt = 0;
        return;
      }
      lastTapAt = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
      // Schedule pause/play — cancelled if a second tap arrives in 320ms
      pendingSingle = setTimeout(function () {
        pendingSingle = null;
        var v = slideEl.querySelector('video');
        if (!v) return;
        if (v.paused) {
          v.play().catch(function () {});
        } else {
          v.pause();
          // Show a play-icon overlay briefly so the customer sees the pause
          var ico = document.createElement('div');
          ico.className = '_btgv_pauseicon';
          ico.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
          slideEl.appendChild(ico);
          ico.addEventListener('animationend', function () { ico.remove(); });
        }
      }, 320);
    });
  }

  function spawnDoubleTapHeart(slideEl, clientX, clientY) {
    var rect = slideEl.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    var heart = document.createElement('div');
    heart.className = '_btgv_dtheart';
    heart.textContent = '❤';
    heart.style.color = '#F72585';
    heart.style.left = x + 'px';
    heart.style.top = y + 'px';
    slideEl.appendChild(heart);
    heart.addEventListener('animationend', function () { heart.remove(); });
    // Also spawn a few smaller floating hearts for richness
    if (typeof spawnHeart === 'function') {
      try { spawnHeart(); } catch (_) {}
    }
  }

  // ─── Product shelf for feed/story overlay ────────────────────────────────────
  function buildProductShelf(tags, videoId) {
    var shelf = document.createElement('div');
    shelf.className = '_btgv_pshelf';
    var row = document.createElement('div');
    row.className = '_btgv_prow';

    tags.forEach(function (tag) {
      var card = document.createElement('div');
      card.className = '_btgv_pcard';

      var img = document.createElement('img');
      img.className = '_btgv_pcard_img';
      img.src = tag.image_url || '';
      img.alt = '';
      img.onerror = function () { this.style.display = 'none'; };

      var body = document.createElement('div');
      body.className = '_btgv_pcard_body';

      var nm = document.createElement('div');
      nm.className = '_btgv_pcard_name';
      nm.textContent = tag.product_name;

      var pr = document.createElement('div');
      pr.className = '_btgv_pcard_price';
      var price = parseFloat(tag.price || 0);
      var was = parseFloat(tag.compare_at_price || 0);
      if (price > 0) {
        var ps = document.createElement('span'); ps.textContent = '$' + price.toFixed(2);
        pr.appendChild(ps);
        if (was > price) {
          var ws = document.createElement('span'); ws.className = '_btgv_pcard_was'; ws.textContent = '$' + was.toFixed(2);
          var ds = document.createElement('span'); ds.className = '_btgv_pcard_disc'; ds.textContent = Math.round((1 - price / was) * 100) + '% off';
          pr.appendChild(ws); pr.appendChild(ds);
        }
      }

      var actions = document.createElement('div');
      actions.className = '_btgv_pcard_actions';

      function iconBtn(cls, icon, lbl, fn) {
        var btn = document.createElement('button');
        btn.className = '_btgv_icon_btn ' + cls;
        btn.innerHTML = '<span style="font-size:16px">' + icon + '</span><span class="_btgv_icon_lbl">' + lbl + '</span>';
        btn.onclick = function (e) { e.stopPropagation(); fn(btn); };
        return btn;
      }

      actions.appendChild(iconBtn('_btgv_ib_cart', '🛒', 'Cart', function (btn) {
        track(videoId, 'add_to_cart', tag.shopify_product_id);
        pauseFeedForAction();
        addToCart(tag.shopify_variant_id, function (ok) {
          fireConfetti();
          if (ok) {
            btn.innerHTML = '<span style="font-size:16px">✓</span><span class="_btgv_icon_lbl">Added</span>';
            setTimeout(function () { btn.innerHTML = '<span style="font-size:16px">🛒</span><span class="_btgv_icon_lbl">Cart</span>'; }, 2500);
          }
          resumeFeedAfterAction();
        });
      }));
      actions.appendChild(iconBtn('_btgv_ib_buy', '⚡', 'Buy', function () {
        track(videoId, 'add_to_cart', tag.shopify_product_id);
        pauseFeedForAction();
        addToCart(tag.shopify_variant_id, function (ok) {
          if (ok) { fireConfetti(); window.location.href = '/checkout'; }
          else { resumeFeedAfterAction(); }
        });
      }));
      actions.appendChild(iconBtn('_btgv_ib_neg', '🤝', 'Negotiate', function () {
        track(videoId, 'negotiate', tag.shopify_product_id);
        pauseFeedForAction();
        _btgvStartChatNegotiation(tag);
      }));

      body.appendChild(nm); body.appendChild(pr); body.appendChild(actions);
      card.appendChild(img); card.appendChild(body);
      row.appendChild(card);
    });

    shelf.appendChild(row);
    return shelf;
  }

  // ─── Negotiate modal (exact match of main widget openChat flow) ─────────────
  function openNegotiateModal(tag) {
    var existingHost = document.getElementById('_btgv_neg_host');
    if (existingHost) { existingHost.remove(); return; }

    // Normalize field names — accept both naming conventions from different callers
    if (!tag.shopify_variant_id && tag.variant_id) tag.shopify_variant_id = tag.variant_id;
    if (!tag.product_handle && tag.handle) tag.product_handle = tag.handle;

    var listPrice = parseFloat(tag.price || 0);
    var negId = null, loading = false, dealShown = false;

    // Shadow DOM for full CSS isolation (same approach as main widget)
    var host = document.createElement('div');
    host.id = '_btgv_neg_host';
    var shadow = host.attachShadow({ mode: 'open' });

    var bg = '#6366f1', fg = '#fff';
    // Try to inherit store button color
    try {
      var storeBtn = document.querySelector('[data-add-to-cart],[name="add"],.btn-cart,#AddToCart');
      if (storeBtn) {
        var cs = window.getComputedStyle(storeBtn);
        if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') bg = cs.backgroundColor;
        if (cs.color) fg = cs.color;
      }
    } catch (e) {}

    var style = document.createElement('style');
    style.textContent = [
      '* { box-sizing: border-box; margin: 0; padding: 0; }',
      '#overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.48); z-index: 2147483646;',
      '  display: flex; align-items: flex-end; justify-content: center; }',
      '#panel { background: #fff; border-radius: 16px 16px 0 0; width: 100%; max-width: 420px; height: 580px;',
      '  display: flex; flex-direction: column; font-family: system-ui,sans-serif; overflow: hidden;',
      '  box-shadow: 0 -8px 40px rgba(0,0,0,0.18); position: relative; }',
      '.hdr { padding: 16px 20px; background: ' + bg + '; color: ' + fg + '; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }',
      '.hdr-left { display: flex; align-items: center; gap: 10px; min-width: 0; }',
      '.hdr-thumb { width: 36px; height: 36px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }',
      '.hdr h3 { font-size: 15px; font-weight: 600; }',
      '.hdr p { font-size: 11px; opacity: 0.8; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }',
      '.close-btn { background: none; border: none; color: inherit; cursor: pointer; font-size: 20px; padding: 0 4px; flex-shrink: 0; }',
      '.msgs { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f7f7f8; }',
      '.msg { max-width: 85%; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.5; }',
      '.msg.bot { background: #fff; color: #1a1a1a; border-radius: 14px 14px 14px 2px; align-self: flex-start; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }',
      '.msg.user { background: ' + bg + '; color: ' + fg + '; border-radius: 14px 14px 2px 14px; align-self: flex-end; }',
      '.typing { display: flex; align-items: center; gap: 4px; align-self: flex-start; padding: 10px 14px;',
      '  background: #fff; border-radius: 14px 14px 14px 2px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }',
      '.typing span { width: 6px; height: 6px; background: #bbb; border-radius: 50%; animation: bounce 1.2s infinite; }',
      '.typing span:nth-child(2) { animation-delay: 0.2s; }',
      '.typing span:nth-child(3) { animation-delay: 0.4s; }',
      '@keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }',
      '.reaction { font-size: 12px; color: #6b7280; align-self: flex-end; padding: 2px 4px; animation: fadein 0.2s ease; }',
      '@keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }',
      '.chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 2px 0 10px 0; }',
      '.chip-accept { background: #16a34a; color: #fff; border: none; border-radius: 20px; padding: 7px 16px;',
      '  font-size: 12px; font-weight: 700; cursor: pointer; letter-spacing: 0.01em; }',
      '.chip-counter { background: #f3f4f6; color: #555; border: none; border-radius: 20px; padding: 7px 14px;',
      '  font-size: 12px; font-weight: 600; cursor: pointer; }',
      '.input-row { display: flex; padding: 12px 16px; gap: 8px; border-top: 1px solid #eee; background: #fff; flex-shrink: 0; }',
      '.inp { flex: 1; border: 1.5px solid #ddd; border-radius: 20px; padding: 10px 16px; font-size: 13px;',
      '  font-family: inherit; outline: none; transition: border 0.15s; }',
      '.inp:focus { border-color: ' + bg + '; }',
      '.send { background: ' + bg + '; color: ' + fg + '; border: none; border-radius: 50%; width: 40px; height: 40px;',
      '  cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }',
      '.send:disabled { opacity: 0.5; cursor: default; }',
      // Deal screen
      '.deal-screen { position: absolute; inset: 0; background: #111; display: flex; flex-direction: column;',
      '  align-items: center; justify-content: center; gap: 0; z-index: 20; transform: translateY(100%);',
      '  transition: transform 0.5s ease-out; overflow: hidden; border-radius: 16px 16px 0 0; }',
      '.deal-screen.visible { transform: translateY(0); }',
      '.deal-check { margin-bottom: 18px; }',
      '.deal-check circle { opacity: 0; animation: circlein 0.3s ease-out 0.2s forwards; }',
      '@keyframes circlein { to { opacity: 1; } }',
      '.checkmark { animation: draw 0.4s ease-out 0.2s forwards; }',
      '@keyframes draw { to { stroke-dashoffset: 0; } }',
      '.deal-product { font-size: 12px; color: #888; margin-bottom: 10px; text-align: center; padding: 0 24px; }',
      '.deal-price-wrap { position: relative; text-align: center; margin-bottom: 6px; }',
      '.deal-price-num { font-size: 52px; font-weight: 800; color: #fff; line-height: 1; font-family: system-ui,sans-serif; }',
      '.deal-orig-num { font-size: 16px; color: #555; text-decoration: line-through; margin-bottom: 4px; text-align: center; }',
      '.deal-savings { display: inline-block; background: #1a472a; color: #7dcc99; font-size: 12px; font-weight: 600;',
      '  padding: 4px 12px; border-radius: 20px; margin-bottom: 18px; opacity: 0; transition: opacity 0.4s ease; }',
      '.deal-savings.show { opacity: 1; }',
      '.deal-code-line { font-size: 11px; color: #555; margin-bottom: 20px; letter-spacing: 0.02em; }',
      '.deal-timer-wrap { text-align: center; margin-bottom: 8px; }',
      '.deal-timer-digits { font-size: 28px; font-weight: 700; color: #fff; font-family: monospace; letter-spacing: 4px; transition: color 0.3s; }',
      '.deal-timer-digits.urgent { color: #e8534a; }',
      '.deal-timer-label { font-size: 11px; color: #555; margin-top: 2px; }',
      '.deal-fallback { display: none; margin-top: 14px; padding: 10px 28px; background: #1a472a; color: #fff;',
      '  border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }',
      '.deal-progress { position: absolute; bottom: 0; left: 0; height: 3px; background: #1a472a; width: 0%; transition: width 0.5s linear; }',
    ].join('');
    shadow.appendChild(style);

    var overlay = document.createElement('div');
    overlay.id = 'overlay';

    var panel = document.createElement('div');
    panel.id = 'panel';

    // Header
    var hdr = document.createElement('div'); hdr.className = 'hdr';
    var hdrLeft = document.createElement('div'); hdrLeft.className = 'hdr-left';
    if (tag.image_url) {
      var hdrThumb = document.createElement('img');
      hdrThumb.className = 'hdr-thumb'; hdrThumb.src = tag.image_url; hdrThumb.alt = '';
      hdrLeft.appendChild(hdrThumb);
    }
    var hdrText = document.createElement('div');
    var hdrTitle = document.createElement('h3'); hdrTitle.textContent = '💬 Make an offer';
    var hdrSub = document.createElement('p'); hdrSub.textContent = tag.product_name || '';
    hdrText.appendChild(hdrTitle); hdrText.appendChild(hdrSub);
    hdrLeft.appendChild(hdrText);
    var closeBtn = document.createElement('button'); closeBtn.className = 'close-btn'; closeBtn.innerHTML = '&#x2715;';
    closeBtn.onclick = function () { closeNeg(); };
    hdr.appendChild(hdrLeft); hdr.appendChild(closeBtn);
    panel.appendChild(hdr);

    var msgsEl = document.createElement('div'); msgsEl.className = 'msgs';
    panel.appendChild(msgsEl);

    var inpRow = document.createElement('div'); inpRow.className = 'input-row'; inpRow.id = 'input-row';
    var inp = document.createElement('input'); inp.className = 'inp'; inp.type = 'text';
    inp.placeholder = 'Type your offer or reply...'; inp.autocomplete = 'off';
    var sendBtn = document.createElement('button'); sendBtn.className = 'send'; sendBtn.innerHTML = '&#10148;'; sendBtn.disabled = true;
    inpRow.appendChild(inp); inpRow.appendChild(sendBtn);
    panel.appendChild(inpRow);

    overlay.appendChild(panel);
    shadow.appendChild(overlay);
    document.body.appendChild(host);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeNeg(); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !sendBtn.disabled) send(); });
    sendBtn.addEventListener('click', send);

    function closeNeg() {
      host.remove();
      try { document.dispatchEvent(new CustomEvent('botiga:neg-closed')); } catch (e) {}
    }

    function removeTyping() {
      var t = shadow.querySelector('#_typing'); if (t) t.remove();
      shadow.querySelectorAll('.reaction').forEach(function (r) { r.remove(); });
    }

    function showTyping() {
      removeTyping();
      var t = document.createElement('div'); t.className = 'typing'; t.id = '_typing';
      t.innerHTML = '<span></span><span></span><span></span>';
      msgsEl.appendChild(t); msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function setLoading(state) {
      loading = state; sendBtn.disabled = state; inp.disabled = state;
    }

    function showOfferReaction(text) {
      if (!listPrice) return;
      var m = text.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/);
      if (!m) return;
      var offer = parseFloat(m[1].replace(/[,\s]/g, ''));
      if (offer <= 0) return;
      var pct = offer / listPrice;
      var emoji, label;
      if (pct >= 0.90)      { emoji = '🤩'; label = 'Getting warmer...'; }
      else if (pct >= 0.80) { emoji = '😊'; label = 'Not bad...'; }
      else                  { emoji = '😬'; label = "That's a tough one..."; }
      var r = document.createElement('div'); r.className = 'reaction';
      r.textContent = emoji + ' ' + label;
      msgsEl.appendChild(r); msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function appendMsg(role, text) {
      removeTyping();
      shadow.querySelectorAll('.chips').forEach(function (c) { c.remove(); });
      var m = document.createElement('div');
      m.className = 'msg ' + role;
      m.textContent = text;
      msgsEl.appendChild(m);

      // Accept / counter chips for bot messages with a price that aren't deal closes
      if (role === 'bot') {
        var pm = text.match(/\$[\d,]+(?:\.\d{1,2})?/);
        var isDeal = /checkout|you've got a deal|deal is locked|expired/i.test(text);
        if (pm && !isDeal) {
          var chips = document.createElement('div'); chips.className = 'chips';
          var acceptBtn = document.createElement('button'); acceptBtn.className = 'chip-accept';
          acceptBtn.textContent = '✓ Accept ' + pm[0];
          var counterBtn = document.createElement('button'); counterBtn.className = 'chip-counter';
          counterBtn.textContent = 'Make a counter';
          acceptBtn.addEventListener('click', function () { chips.remove(); inp.value = 'I accept'; send(); });
          counterBtn.addEventListener('click', function () {
            chips.remove();
            appendMsg('bot', 'Sure, what\'s your counter offer? Type it below 👇');
            inp.focus();
          });
          chips.appendChild(counterBtn); chips.appendChild(acceptBtn);
          msgsEl.appendChild(chips);
        }
      }

      msgsEl.scrollTop = msgsEl.scrollHeight;
      return m;
    }

    function showGate(d) {
      removeTyping();

      // Try to resolve contact from Shopify customer session or prior capture — skip the form if found
      var _savedContact = (function () {
        try { return localStorage.getItem('_btgv_contact_' + API_KEY) || null; } catch (e) { return null; }
      })();
      var _shopifyEmail = (function () {
        try {
          return (window.meta && window.meta.page && window.meta.page.email) ||
            (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.email) ||
            null;
        } catch (e) { return null; }
      })();
      var _autoContact = _savedContact || _shopifyEmail;

      function doUnlock(contact, triggerEl) {
        // Persist for future negotiations
        try { localStorage.setItem('_btgv_contact_' + API_KEY, contact); } catch (e) {}
        try { _btgvFireFunnelEvent('captured', { surface: 'price_gate' }); } catch (_) {}
        if (triggerEl) { triggerEl.disabled = true; triggerEl.textContent = '...'; }
        fetch(API_BASE + '/api/negotiate/' + negId + '/contact', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact: contact })
        }).then(function () {
          shadow.querySelectorAll('._btg_p').forEach(function (el) { el.style.filter = 'blur(0px)'; });
          setTimeout(function () {
            if (g && g.parentNode) g.remove();
            appendMsg('bot', d.bot_reply);
            setLoading(false); sendBtn.disabled = false; inp.disabled = false;
            setTimeout(function () { inp.focus(); }, 80);
          }, 900);
        }).catch(function () {
          shadow.querySelectorAll('._btg_p').forEach(function (el) { el.style.filter = 'blur(0px)'; });
          setTimeout(function () {
            if (g && g.parentNode) g.remove();
            appendMsg('bot', d.bot_reply);
            setLoading(false); sendBtn.disabled = false; inp.disabled = false;
          }, 900);
        });
      }

      // If contact already known, skip the gate entirely
      if (_autoContact) {
        setLoading(false); sendBtn.disabled = false; inp.disabled = false;
        doUnlock(_autoContact, null);
        return;
      }

      var g = document.createElement('div'); g.className = 'msg bot';
      var blurred = d.bot_reply.replace(/\$[\d,]+(?:\.\d{1,2})?/g, function (m) {
        return '<span class="_btg_p" style="filter:blur(2px);transition:filter 0.8s ease;display:inline-block;user-select:none">' + m + '</span>';
      });
      g.innerHTML =
        '<div style="font-size:11px;font-weight:600;color:#6366f1;letter-spacing:0.03em;margin-bottom:8px">🔒 I found a private price on this</div>' +
        '<div style="line-height:1.6;margin-bottom:12px">' + blurred + '</div>' +
        '<div style="font-size:12px;color:#555;margin-bottom:8px">Drop your email or phone number and I\'ll send you the deal the moment it\'s locked in.</div>' +
        '<form id="_btg_f" style="display:flex;gap:6px;margin-bottom:8px">' +
          '<input id="_btg_c" type="text" placeholder="Email or phone number" autocomplete="email"' +
          ' style="flex:1;min-width:0;border:1.5px solid #e5e5e5;border-radius:8px;padding:9px 11px;font-size:13px;outline:none;font-family:inherit;transition:border-color .15s" />' +
          '<button type="submit" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">Unlock →</button>' +
        '</form>' +
        '<div id="_btg_err" style="font-size:11px;color:#ef4444;min-height:14px;margin-bottom:4px"></div>' +
        '<div style="font-size:10px;color:#bbb">🔒 No spam. Just your deal — delivered instantly.</div>';
      msgsEl.appendChild(g); msgsEl.scrollTop = msgsEl.scrollHeight;

      setLoading(false); sendBtn.disabled = true; inp.disabled = true;
      requestAnimationFrame(function () {
        var ci = shadow.querySelector('#_btg_c');
        if (ci) {
          ci.focus();
          ci.addEventListener('focus', function () { ci.style.borderColor = '#6366f1'; });
          ci.addEventListener('blur', function () { ci.style.borderColor = '#e5e5e5'; });
        }
      });

      shadow.querySelector('#_btg_f').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var val = shadow.querySelector('#_btg_c').value.trim();
        var errEl = shadow.querySelector('#_btg_err');
        if (!val) { errEl.textContent = 'Please enter your email or phone number.'; return; }
        var isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
        var isPhone = /^[\+\d][\d\s\-().]{6,}$/.test(val);
        if (!isEmail && !isPhone) { errEl.textContent = 'Please enter a valid email or phone number.'; return; }
        errEl.textContent = '';
        doUnlock(val, shadow.querySelector('#_btg_f button[type=submit]'));
      });
    }

    function showDeal(dealPrice, checkoutUrl, discountCode, invoiceUrl) {
      if (dealShown) return; dealShown = true;
      var inputRowEl = shadow.querySelector('#input-row'); if (inputRowEl) inputRowEl.remove();
      var saved = Math.round(listPrice - dealPrice);
      var savedPct = Math.round((saved / listPrice) * 100);

      // Resolve final destination once — Draft Order URL wins.
      var finalUrl = invoiceUrl || checkoutUrl || '';
      var isDraftOrder = /\/(invoices|checkouts)\//.test(finalUrl);
      var dest = isDraftOrder
        ? finalUrl
        : (discountCode ? '/checkout?discount=' + encodeURIComponent(discountCode) : '/checkout');

      // No-Draft-Order fallback: ensure variant is in cart so /cart?discount works.
      if (!isDraftOrder && tag.shopify_variant_id) {
        addToCart(tag.shopify_variant_id, function () {});
      }

      // Persist this deal into the concierge chat history so the conversation
      // continues seamlessly when the user re-opens the concierge.
      try {
        _cncgSaveMsg('b', '🎁 Locked in ' + (tag.product_name || 'this item') + ' at $' + Math.round(dealPrice) + (saved > 0 ? ' (saved $' + saved + ')' : ''));
      } catch (e) {}

      // Per-deal confirmation — celebration is gated behind the Checkout click
      var ds = document.createElement('div'); ds.className = 'deal-screen';
      ds.innerHTML =
        '<svg class="deal-check" viewBox="0 0 52 52" width="52" height="52">' +
          '<circle cx="26" cy="26" r="24" fill="none" stroke="#1a472a" stroke-width="2"/>' +
          '<path class="checkmark" fill="none" stroke="white" stroke-width="3"' +
          ' stroke-linecap="round" stroke-linejoin="round" d="M14 27l8 8 16-16"' +
          ' stroke-dasharray="36" stroke-dashoffset="36"/></svg>' +
        '<div class="deal-product">' + (tag.product_name || '') + '</div>' +
        '<div class="deal-orig-num">' + (listPrice !== dealPrice ? '$' + Math.round(listPrice) : '') + '</div>' +
        '<div class="deal-price-wrap"><div class="deal-price-num" id="_dp">$' + Math.round(dealPrice) + '</div></div>' +
        '<div class="deal-savings" id="_ds">' + (saved > 0 ? 'You saved $' + saved + ' · ' + savedPct + '% off' : 'Deal locked in') + '</div>' +
        '<div id="_btg_post" style="display:flex;flex-direction:column;gap:8px;margin-top:22px;width:100%;max-width:280px;align-self:center">' +
          '<button id="_btg_keep" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.3);padding:10px 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px">🛍️ Keep shopping</button>' +
          '<button id="_btg_chk" style="background:#16a34a;color:#fff;border:none;padding:11px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px">⚡ Checkout</button>' +
          '<button id="_btg_hold" style="background:transparent;color:#a5b4fc;border:1px solid rgba(165,180,252,0.4);padding:9px 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px">🔖 Save for later · I\'ll email you</button>' +
        '</div>';
      panel.appendChild(ds);
      requestAnimationFrame(function () { ds.classList.add('visible'); });

      setTimeout(function () {
        var badge = shadow.querySelector('#_ds'); if (badge) badge.classList.add('show');
      }, 300);

      var keepBtn = shadow.querySelector('#_btg_keep');
      if (keepBtn) keepBtn.addEventListener('click', function () {
        // Close the negotiation modal, then proactively suggest more options
        _btgNegProduct = null;
        closeNeg();
        _cncgShowMoreOptions();
      });

      var chkBtn = shadow.querySelector('#_btg_chk');
      if (chkBtn) chkBtn.addEventListener('click', function () {
        var post = shadow.querySelector('#_btg_post');
        if (post) post.style.display = 'none';
        var headline = document.createElement('div');
        headline.style.cssText = 'font-size:22px;font-weight:700;color:#fff;margin-top:18px;letter-spacing:0.2px;text-align:center';
        headline.textContent = 'Deal Done, Darling! 🎉';
        ds.appendChild(headline);
        var sub = document.createElement('div');
        sub.style.cssText = 'font-size:13px;color:#888;margin-top:8px;text-align:center';
        sub.textContent = 'Taking you to checkout…';
        ds.appendChild(sub);
        setTimeout(function () { if (dest) window.location.href = dest; }, 1100);
      });

      // Hold-your-place — locks in the negotiated price for 24h and emails
      // the checkout link. The merchant gets a "Held" hot lead in the
      // dashboard. If we don't have an email captured yet, prompt for one
      // inline before posting.
      var holdBtn = shadow.querySelector('#_btg_hold');
      if (holdBtn) holdBtn.addEventListener('click', function () {
        var negId = (typeof getCurrentNegotiationId === 'function')
          ? getCurrentNegotiationId()
          : (typeof _btgvCurrentNegId !== 'undefined' ? _btgvCurrentNegId : null);
        // Try to find it from the latest deal saved in localStorage
        if (!negId && typeof _btgvGetDeals === 'function') {
          var ds_ = _btgvGetDeals();
          if (ds_.length) negId = ds_[ds_.length - 1].negotiationId;
        }
        if (!negId) {
          alert("Couldn't identify this deal — try Keep shopping instead.");
          return;
        }

        var sess = (function () { try { return JSON.parse(localStorage.getItem('_botiga_session') || '{}'); } catch (_) { return {}; } })();
        var existingEmail = sess.email || null;

        function postHold(emailValue) {
          fetch(API_BASE + '/api/negotiations/' + encodeURIComponent(negId) + '/hold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailValue || null }),
          }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
            holdBtn.disabled = true;
            holdBtn.style.opacity = '0.6';
            holdBtn.textContent = d && d.ok ? '✓ Held — check your email 📧' : 'Saved';
            _btgvFireFunnelEvent('held', { negotiation_id: negId });
          }).catch(function () {
            holdBtn.textContent = '✕ Couldn\'t save — try again';
          });
        }

        if (existingEmail) {
          postHold(existingEmail);
        } else {
          // Inline prompt — replace the button row with a quick email input
          var post = shadow.querySelector('#_btg_post');
          if (!post) { postHold(null); return; }
          post.innerHTML =
            '<div style="font-size:12px;color:#fff;margin-bottom:6px">📧 Where should I send your saved deal?</div>' +
            '<input id="_btg_hold_email" type="email" placeholder="you@email.com" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:8px;padding:10px 12px;font-size:13px;outline:none;width:100%;box-sizing:border-box" />' +
            '<button id="_btg_hold_send" style="background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;margin-top:6px">Save for 24h →</button>';
          var inp = shadow.querySelector('#_btg_hold_email');
          var send = shadow.querySelector('#_btg_hold_send');
          if (inp) setTimeout(function () { try { inp.focus(); } catch (_) {} }, 80);
          if (send) send.addEventListener('click', function () {
            var v = (inp && inp.value || '').trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
              if (inp) inp.style.borderColor = '#ef4444';
              return;
            }
            // Persist for next time
            try { localStorage.setItem('_botiga_session', JSON.stringify(Object.assign({}, sess, { email: v, ts: Date.now() }))); } catch (_) {}
            send.disabled = true;
            send.textContent = 'Saving…';
            postHold(v);
          });
        }
      });
    }

    function doNegotiate(customerMsg) {
      var body = {
        api_key: API_KEY, session_id: SESSION_ID, session_token: SESSION_TOKEN,
        product_name: tag.product_name || '',
        product_url: window.location.href,
        product_image: tag.image_url || null,
        variant_id: tag.shopify_variant_id || null,
        list_price: listPrice,
        opening: !customerMsg
      };
      if (negId) body.negotiation_id = negId;
      if (customerMsg) body.customer_message = customerMsg;
      if (tag._productContext) body.product_context = tag._productContext;

      fetch(API_BASE + '/api/negotiate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          removeTyping();
          if (d.error) {
            appendMsg('bot', "Hey! Let's see if we can make a deal. What's your offer?");
            setLoading(false); sendBtn.disabled = false; inp.disabled = false;
            setTimeout(function () { inp.focus(); }, 80);
            return;
          }
          negId = d.negotiation_id;
          if (d.needs_lead_capture && d.offered_price) {
            showGate(d);
          } else {
            appendMsg('bot', d.bot_reply);
            // Funnel event: customer entered negotiation flow
            if (d.negotiation_id) {
              try { _btgvFireFunnelEvent('negotiated', { negotiation_id: d.negotiation_id, product: tag.product_name }); } catch (_) {}
            }
            if (d.status === 'won' && d.deal_price) {
              try { _btgvFireFunnelEvent('won', { negotiation_id: d.negotiation_id, deal_price: d.deal_price }); } catch (_) {}
              // Persist deal to localStorage (survives page navigation)
              var newDeal = {
                negotiationId: d.negotiation_id,
                productName: tag.product_name || '',
                listPrice: listPrice,
                price: d.deal_price,
                checkoutUrl: d.checkout_url,
                invoiceUrl: d.draft_order_invoice_url || d.checkout_url,
                draftOrderId: d.draft_order_id || null,
                lineItemId: d.draft_order_line_item_id || null,
                discountCode: d.discount_code || null,
                expiresAt: d.expires_at || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
              };
              _btgvSaveDeal(newDeal);
              _cncgUpdateProfile({ negotiated: { name: tag.product_name, dealPrice: Math.round(d.deal_price), listPrice: Math.round(listPrice) } });
              _cncgUpdateProfile({ priceSignal: { accepted: d.deal_price } });
              try { document.dispatchEvent(new CustomEvent('botiga:deal', { detail: { price: d.deal_price } })); } catch (e) {}
              showDeal(d.deal_price, d.checkout_url, d.discount_code, d.draft_order_invoice_url);
            } else {
              setLoading(false); sendBtn.disabled = false; inp.disabled = false;
              setTimeout(function () { inp.focus(); }, 80);
            }
          }
        })
        .catch(function () {
          removeTyping();
          appendMsg('bot', "Hey! What offer did you have in mind? 😊");
          setLoading(false); sendBtn.disabled = false; inp.disabled = false;
        });
    }

    function send() {
      var text = inp.value.trim(); if (!text || loading) return;
      inp.value = '';
      appendMsg('user', text);
      showOfferReaction(text);
      var delay = listPrice > 0 ? ((parseFloat(text.replace(/[^0-9.]/g, '')) / listPrice) < 0.70 ? 2500 : 1500) : 1500;
      setLoading(true);
      setTimeout(function () { showTyping(); }, Math.max(0, delay - 600));
      setTimeout(function () { doNegotiate(text); }, delay);
    }

    setLoading(true); showTyping();

    // Fetch product context from Shopify's free public endpoint before opening call
    if (tag.product_handle && !tag._productContext) {
      fetch('/products/' + tag.product_handle + '.js')
        .then(function (r) { return r.json(); })
        .then(function (p) {
          tag._productContext = {
            vendor: p.vendor || null,
            product_type: p.product_type || null,
            tags: p.tags || [],
            description: (p.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 400)
          };
        })
        .catch(function () {})
        .then(function () { setTimeout(function () { doNegotiate(null); }, 600); });
    } else {
      setTimeout(function () { doNegotiate(null); }, 1200);
    }
  }

  // ─── Mixed-feed helpers ──────────────────────────────────────────────────────
  function extractProductItems(vids) {
    var seen = {};
    var items = [];
    vids.forEach(function (vid) {
      (vid.video_product_tags || []).forEach(function (tag) {
        var pid = tag.shopify_product_id;
        if (pid && !seen[pid] && tag.image_url) {
          seen[pid] = true;
          items.push(Object.assign({}, tag, { _type: 'product', _videoId: vid.id }));
        }
      });
    });
    return items;
  }

  function buildMixedFeed(vids, productItems) {
    var result = vids.map(function (v) { return Object.assign({ _type: 'video' }, v); });
    if (!productItems.length) return result;
    var out = [], pi = 0;
    result.forEach(function (item, i) {
      out.push(item);
      // Insert one product card after every 3rd video
      if ((i + 1) % 3 === 0 && pi < productItems.length) out.push(productItems[pi++]);
    });
    return out;
  }

  // ─── Comments drawer ─────────────────────────────────────────────────────────
  function fmtCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  function timeAgo(iso) {
    var s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function renderComment(c) {
    var wrap = document.createElement('div');
    wrap.className = '_btgv_cmt_item';

    function buildRow(comment, isMerchant) {
      var row = document.createElement('div'); row.className = '_btgv_cmt_row';
      var av = document.createElement('div');
      av.className = '_btgv_cmt_av ' + (isMerchant ? 'merchant' : 'customer');
      av.textContent = (comment.author_name || 'A')[0].toUpperCase();
      var info = document.createElement('div'); info.className = '_btgv_cmt_info';
      var nameline = document.createElement('div'); nameline.className = '_btgv_cmt_nameline';
      var nm = document.createElement('span'); nm.className = '_btgv_cmt_name'; nm.textContent = comment.author_name;
      nameline.appendChild(nm);
      if (isMerchant) {
        var badge = document.createElement('span'); badge.className = '_btgv_cmt_shop_badge'; badge.textContent = 'Shop';
        nameline.appendChild(badge);
      }
      var body = document.createElement('div'); body.className = '_btgv_cmt_body'; body.textContent = comment.body;
      var time = document.createElement('div'); time.className = '_btgv_cmt_time'; time.textContent = timeAgo(comment.created_at);
      info.appendChild(nameline); info.appendChild(body); info.appendChild(time);
      row.appendChild(av); row.appendChild(info);
      return row;
    }

    wrap.appendChild(buildRow(c, c.is_merchant_reply));
    if (c.replies && c.replies.length) {
      var replies = document.createElement('div'); replies.className = '_btgv_cmt_replies';
      c.replies.forEach(function (r) { replies.appendChild(buildRow(r, r.is_merchant_reply)); });
      wrap.appendChild(replies);
    }
    return wrap;
  }

  function buildCommentDrawer(videoId, initialCount, onCountChange) {
    var drawer = document.createElement('div');
    drawer.className = '_btgv_cmt_drawer';
    var loaded = false;

    // Drag handle pill
    var pill = document.createElement('div'); pill.className = '_btgv_cmt_pill';
    drawer.appendChild(pill);

    // Top row: count + close
    var toprow = document.createElement('div'); toprow.className = '_btgv_cmt_toprow';
    var cnt = document.createElement('span'); cnt.className = '_btgv_cmt_cnt';
    cnt.textContent = initialCount + ' comments';
    var closeBtn = document.createElement('button'); closeBtn.className = '_btgv_cmt_close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.onclick = function () { drawer.classList.remove('open'); };
    toprow.appendChild(cnt); toprow.appendChild(closeBtn);
    drawer.appendChild(toprow);

    // Comment list
    var list = document.createElement('div'); list.className = '_btgv_cmt_list';
    drawer.appendChild(list);

    // Footer
    var foot = document.createElement('div'); foot.className = '_btgv_cmt_foot';

    // Name input — shown only when name not yet saved
    var savedName = '';
    try { savedName = localStorage.getItem('_btgv_name') || ''; } catch (e) {}

    var nameWrap = document.createElement('div'); nameWrap.className = '_btgv_cmt_namewrap';
    var nameInp = document.createElement('input');
    nameInp.className = '_btgv_cmt_nameinp'; nameInp.placeholder = 'Your name…';
    nameInp.value = savedName;
    nameWrap.appendChild(nameInp);
    if (savedName) nameWrap.style.display = 'none';
    foot.appendChild(nameWrap);

    // Send row: user avatar + text input + arrow button
    var sendRow = document.createElement('div'); sendRow.className = '_btgv_cmt_sendrow';
    var uav = document.createElement('div'); uav.className = '_btgv_cmt_uav';
    uav.textContent = (savedName || '?')[0].toUpperCase();
    var bodyInp = document.createElement('input');
    bodyInp.className = '_btgv_cmt_inp'; bodyInp.placeholder = 'Add a comment…';
    var sendBtn = document.createElement('button');
    sendBtn.className = '_btgv_cmt_send'; sendBtn.disabled = true;
    sendBtn.textContent = 'Post';
    sendRow.appendChild(uav); sendRow.appendChild(bodyInp); sendRow.appendChild(sendBtn);
    foot.appendChild(sendRow);
    drawer.appendChild(foot);

    function validate() {
      var name = nameInp.value.trim() || savedName;
      sendBtn.disabled = !bodyInp.value.trim() || !name;
    }

    function refreshList() {
      list.innerHTML = '';
      fetch(API_BASE + '/api/widget/videos/' + videoId + '/comments')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var comments = d.comments || [];
          cnt.textContent = comments.length + ' comments';
          if (onCountChange) onCountChange(comments.length);
          if (!comments.length) {
            var em = document.createElement('div'); em.className = '_btgv_cmt_empty';
            em.textContent = 'Be the first to comment';
            list.appendChild(em);
          } else {
            comments.forEach(function (c) { list.appendChild(renderComment(c)); });
            list.scrollTop = list.scrollHeight;
          }
        })
        .catch(function () {});
    }

    function open() {
      drawer.classList.add('open');
      if (!loaded) { loaded = true; refreshList(); }
    }

    bodyInp.addEventListener('input', validate);
    nameInp.addEventListener('input', function () {
      uav.textContent = (nameInp.value.trim() || '?')[0].toUpperCase();
      validate();
    });

    sendBtn.addEventListener('click', function () {
      var name = (nameInp.value.trim() || savedName);
      var body = bodyInp.value.trim();
      if (!name || !body) return;
      sendBtn.disabled = true; sendBtn.innerHTML = '…';
      fetch(API_BASE + '/api/widget/videos/' + videoId + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author_name: name, body: body })
      })
        .then(function (r) { return r.json(); })
        .then(function () {
          // Save name to localStorage
          try { localStorage.setItem('_btgv_name', name); } catch (e) {}
          savedName = name;
          nameWrap.style.display = 'none';
          uav.textContent = name[0].toUpperCase();
          bodyInp.value = '';
          sendBtn.textContent = 'Post';
          refreshList();
        })
        .catch(function () { sendBtn.disabled = false; sendBtn.textContent = 'Post'; });
    });

    // Post on Enter
    bodyInp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !sendBtn.disabled) sendBtn.click();
    });

    drawer.open = open;
    return drawer;
  }

  // Product-card slide. Same look as a video slide so the feed feels
  // consistent: brand badge top-left, right rail (heart/share/save/ask),
  // bottom zone with price + "Make an offer · usually $X-Y" + cart + buy.
  // Hearts on products are session-local (no real "post" to like, but UI
  // consistency wins). Comments and mute are skipped — products have no
  // comment thread and no audio.
  function buildProductSlide(tag, feedContext) {
    feedContext = feedContext || {};
    var productId = tag.shopify_product_id || tag._videoId || ('p_' + Math.random().toString(36).slice(2, 10));

    var slide = document.createElement('div');
    slide.className = '_btgv_slide';
    slide.style.background = '#111';

    if (tag.image_url) {
      var bg = document.createElement('img');
      bg.className = '_btgv_pslide_img'; bg.src = tag.image_url; bg.alt = '';
      slide.appendChild(bg);
    }
    var grad = document.createElement('div'); grad.className = '_btgv_grad'; slide.appendChild(grad);

    // Top bar: brand badge (no view count for products — they have no posts data)
    var topbar = buildTopBar({ views_count: 0 }, feedContext);
    slide.appendChild(topbar);

    // Right rail — heart, share, save, ask (skip comment + mute since
    // products don't have a thread or audio).
    var rail = document.createElement('div'); rail.className = '_btgv_rail';

    // Heart — session-local counter, same animation as video slides.
    var likeBtn = document.createElement('button');
    likeBtn.style.position = 'relative';
    var likeCount = 0;
    var liked = false;
    likeBtn.innerHTML = '<span style="font-size:22px">🤍</span><span>' + likeCount + '</span>';
    function explodeHeartsP(btn) {
      var dirs = [
        { x: -36, y: -42 }, { x: 0, y: -50 }, { x: 36, y: -42 },
        { x: -42, y: -10 }, { x: 42, y: -10 },
      ];
      var glyphs = ['❤', '❤', '💖', '💕', '🧡'];
      dirs.forEach(function (d, i) {
        var h = document.createElement('span');
        h.className = '_btgv_lh';
        h.textContent = glyphs[i % glyphs.length];
        h.style.color = i === 1 ? '#F72585' : '#fff';
        h.style.setProperty('--lhx', d.x + 'px');
        h.style.setProperty('--lhy', d.y + 'px');
        btn.appendChild(h);
        h.addEventListener('animationend', function () { h.remove(); });
      });
    }
    likeBtn.onclick = function (e) {
      e.stopPropagation();
      likeBtn.classList.remove('_btgv_popping');
      void likeBtn.offsetWidth;
      likeBtn.classList.add('_btgv_popping');
      setTimeout(function () { likeBtn.classList.remove('_btgv_popping'); }, 520);
      explodeHeartsP(likeBtn);
      if (!liked) {
        liked = true;
        likeCount++;
        likeBtn.querySelectorAll('span')[0].textContent = '❤️';
        likeBtn.querySelectorAll('span')[1].textContent = String(likeCount);
        track(productId, 'like', tag.shopify_product_id);
      }
    };
    rail.appendChild(likeBtn);

    // Share — copies / native-shares the current page URL
    var shareBtn = document.createElement('button');
    shareBtn.innerHTML = '<span style="font-size:20px">↗️</span><span>Share</span>';
    shareBtn.onclick = function (e) {
      e.stopPropagation();
      track(productId, 'share', tag.shopify_product_id);
      var shareUrlStr = window.location.href;
      if (navigator.share) navigator.share({ url: shareUrlStr }).catch(function () {});
      else { try { navigator.clipboard.writeText(shareUrlStr); } catch (_) {} }
    };
    rail.appendChild(shareBtn);

    // Save — bookmark to localStorage, same key namespace as videos
    var savedSetP = (function () {
      try {
        var raw = localStorage.getItem('_btgv_saves_' + API_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (_) { return {}; }
    })();
    var saveBtn = document.createElement('button');
    var saveKey = 'p:' + productId;
    var isSaved = !!savedSetP[saveKey];
    saveBtn.innerHTML = '<span style="font-size:20px">' + (isSaved ? '🔖' : '📑') + '</span><span>' + (isSaved ? 'Saved' : 'Save') + '</span>';
    saveBtn.onclick = function (e) {
      e.stopPropagation();
      savedSetP[saveKey] = !savedSetP[saveKey];
      try { localStorage.setItem('_btgv_saves_' + API_KEY, JSON.stringify(savedSetP)); } catch (_) {}
      var nowSaved = !!savedSetP[saveKey];
      saveBtn.innerHTML = '<span style="font-size:20px">' + (nowSaved ? '🔖' : '📑') + '</span><span>' + (nowSaved ? 'Saved' : 'Save') + '</span>';
      saveBtn.classList.remove('_btgv_popping');
      void saveBtn.offsetWidth;
      saveBtn.classList.add('_btgv_popping');
      setTimeout(function () { saveBtn.classList.remove('_btgv_popping'); }, 520);
    };
    rail.appendChild(saveBtn);

    // Ask — opens concierge with this product as context
    var askBtn = document.createElement('button');
    askBtn.style.position = 'relative';
    var askInner = '';
    if (feedContext.botAvatar) {
      askInner = '<span style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.12)"><img src="' + feedContext.botAvatar + '" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;display:block"/></span>';
    } else {
      askInner = '<span style="font-size:20px">💬</span>';
    }
    askBtn.innerHTML = askInner + '<span>Ask</span>';
    askBtn.onclick = function (e) {
      e.stopPropagation();
      // Close the feed so the concierge isn't hidden behind it.
      // The feed has z-index 99999, the concierge 99997 — without
      // closing, the chat opens but is invisible. Same fix applied to
      // the video-slide concierge button below.
      if (_cncgEl) _cncgEl._lastShownProducts = [tag];
      if (typeof closeFeed === 'function') closeFeed();
      setTimeout(function () {
        if (typeof openConcierge === 'function') openConcierge();
      }, 300);
    };
    rail.appendChild(askBtn);

    slide.appendChild(rail);

    // Bottom zone — reuse the same builder as video slides so the price
    // line + "Make an offer · usually $X-Y" CTA + cart + buy buttons look
    // identical to a tagged-video slide.
    var bottom = buildBottomZone(
      { id: productId, title: tag.product_name || '', video_product_tags: [tag] },
      [tag],
      feedContext
    );
    slide.appendChild(bottom);

    return slide;
  }

  // ─── Stories bar (type='stories' only) ──────────────────────────────────────
  function buildStoriesBar(container, cols) {
    var storyCols = cols.filter(function (c) { return c.type === 'stories'; });
    if (!storyCols.length) return;

    var row = document.createElement('div');
    row.id = '_btgv_sr';
    storyCols.forEach(function (col) {
      var item = document.createElement('div');
      item.className = '_btgv_story';

      var ring = document.createElement('div');
      ring.className = '_btgv_story_ring';
      var inner = document.createElement('div');
      inner.className = '_btgv_story_inner';
      if (col.thumbnail_url) {
        var img = document.createElement('img');
        img.src = col.thumbnail_url; img.alt = col.name;
        inner.appendChild(img);
      } else {
        inner.style.background = 'linear-gradient(135deg,#6366f1,#ec4899)';
        // Auto-preview: fetch first video and play it silently as a GIF substitute
        (function (innerEl) {
          fetchCollectionVideos(col.id, function (vids) {
            if (!vids.length || !vids[0].s3_url) return;
            var tv = document.createElement('video');
            tv.src = vids[0].s3_url;
            tv.muted = true; tv.playsInline = true;
            tv.preload = 'metadata'; tv.loop = true;
            tv.play().catch(function () {});
            innerEl.style.background = '';
            innerEl.appendChild(tv);
          });
        })(inner);
      }
      ring.appendChild(inner);

      var lbl = document.createElement('div');
      lbl.className = '_btgv_story_lbl';
      lbl.textContent = col.name;

      item.appendChild(ring); item.appendChild(lbl);
      item.onclick = function () {
        ring.className = '_btgv_story_ring seen';
        fetchCollectionVideos(col.id, function (vids) {
          if (vids.length) openStoryViewer(vids, col);
        });
      };
      row.appendChild(item);
    });
    container.appendChild(row);
  }

  // ─── Story viewer ────────────────────────────────────────────────────────────
  function openStoryViewer(vids, col) {
    storyVideos = vids;
    storyIdx = 0;

    if (storyEl) { storyEl.remove(); }
    storyEl = document.createElement('div');
    storyEl.id = '_btgv_sv';
    document.body.appendChild(storyEl);

    var videoEl = document.createElement('video');
    videoEl.className = '_btgv_sv_vid';
    videoEl.playsInline = true;
    videoEl.loop = false;
    storyEl.appendChild(videoEl);

    var progWrap = document.createElement('div');
    progWrap.className = '_btgv_sv_prog';
    vids.forEach(function () {
      var bar = document.createElement('div'); bar.className = '_btgv_sv_bar';
      var fill = document.createElement('div'); fill.className = '_btgv_sv_fill';
      bar.appendChild(fill); progWrap.appendChild(bar);
    });
    storyEl.appendChild(progWrap);

    var hd = document.createElement('div'); hd.className = '_btgv_sv_hd';
    var av = document.createElement('div'); av.className = '_btgv_sv_av';
    if (col.thumbnail_url) {
      var avImg = document.createElement('img'); avImg.src = col.thumbnail_url; av.appendChild(avImg);
    }
    var nm = document.createElement('span'); nm.className = '_btgv_sv_nm'; nm.textContent = col.name;
    var xBtn = document.createElement('button'); xBtn.className = '_btgv_sv_x'; xBtn.innerHTML = '&#x2715;';
    xBtn.onclick = function (e) { e.stopPropagation(); closeStory(); };
    hd.appendChild(av); hd.appendChild(nm); hd.appendChild(xBtn);
    storyEl.appendChild(hd);

    var tl = document.createElement('div'); tl.className = '_btgv_sv_tl';
    var tr = document.createElement('div'); tr.className = '_btgv_sv_tr';
    tl.onclick = function (e) { e.stopPropagation(); stepStory(-1); };
    tr.onclick = function (e) { e.stopPropagation(); stepStory(1); };
    storyEl.appendChild(tl); storyEl.appendChild(tr);

    function onKey(e) {
      if (e.key === 'Escape') closeStory();
      if (e.key === 'ArrowRight') stepStory(1);
      if (e.key === 'ArrowLeft') stepStory(-1);
    }
    document.addEventListener('keydown', onKey);
    storyEl._onkey = onKey;

    requestAnimationFrame(function () { storyEl.classList.add('open'); });
    pushDeepLink('s:' + col.id);
    playStoryFrame(videoEl, progWrap);
  }

  function playStoryFrame(videoEl, progWrap) {
    var vid = storyVideos[storyIdx];
    if (!vid) { closeStory(); return; }
    track(vid.id, 'view');

    var fills = progWrap.querySelectorAll('._btgv_sv_fill');
    fills.forEach(function (f, i) {
      f.style.transition = 'none';
      f.style.width = i < storyIdx ? '100%' : '0%';
    });
    var fill = fills[storyIdx];

    videoEl.src = vid.s3_url;
    videoEl.muted = false;
    videoEl.currentTime = 0;
    var p = videoEl.play();
    if (p && p.catch) p.catch(function () { videoEl.muted = true; videoEl.play().catch(function () {}); });

    if (storyAnimFrame) cancelAnimationFrame(storyAnimFrame);
    function tick() {
      if (!videoEl.duration || !fill) return;
      fill.style.width = Math.min((videoEl.currentTime / videoEl.duration) * 100, 100) + '%';
      if (videoEl.currentTime < videoEl.duration) storyAnimFrame = requestAnimationFrame(tick);
    }
    storyAnimFrame = requestAnimationFrame(tick);

    videoEl.onended = function () {
      if (fill) fill.style.width = '100%';
      if (storyAnimFrame) { cancelAnimationFrame(storyAnimFrame); storyAnimFrame = null; }
      stepStory(1);
    };

    var oldShelf = storyEl.querySelector('._btgv_pshelf');
    if (oldShelf) oldShelf.remove();
    var tags = vid.video_product_tags || [];
    if (tags.length) storyEl.appendChild(buildProductShelf(tags, vid.id));
  }

  function stepStory(dir) {
    if (storyAnimFrame) { cancelAnimationFrame(storyAnimFrame); storyAnimFrame = null; }
    var next = storyIdx + dir;
    if (next < 0 || next >= storyVideos.length) { closeStory(); return; }
    storyIdx = next;
    var videoEl = storyEl && storyEl.querySelector('._btgv_sv_vid');
    var progWrap = storyEl && storyEl.querySelector('._btgv_sv_prog');
    if (videoEl && progWrap) playStoryFrame(videoEl, progWrap);
  }

  function closeStory() {
    if (storyAnimFrame) { cancelAnimationFrame(storyAnimFrame); storyAnimFrame = null; }
    popDeepLink();
    if (storyEl) {
      var v = storyEl.querySelector('video');
      if (v) { v.pause(); v.src = ''; }
      if (storyEl._onkey) document.removeEventListener('keydown', storyEl._onkey);
      storyEl.classList.remove('open');
      setTimeout(function () { if (storyEl) { storyEl.remove(); storyEl = null; } }, 220);
    }
  }

  // ─── Watch & Shop carousel ───────────────────────────────────────────────────
  function buildGrid(container, vids) {
    if (!vids.length) return;

    if (GRID_TITLE && GRID_TITLE !== 'none' && GRID_TITLE !== '0') {
      var gh = document.createElement('div');
      gh.className = '_btgv_gh';
      gh.textContent = GRID_TITLE;
      container.appendChild(gh);
    }

    // Outer wrapper — holds arrows + scroll area
    var outer = document.createElement('div');
    outer.className = '_btgv_gi_outer';

    // ← Prev arrow
    var prevBtn = document.createElement('button');
    prevBtn.className = '_btgv_arrow _btgv_arrow_l hidden';
    prevBtn.innerHTML = '&#8249;';
    prevBtn.setAttribute('aria-label', 'Previous');

    // → Next arrow
    var nextBtn = document.createElement('button');
    nextBtn.className = '_btgv_arrow _btgv_arrow_r';
    nextBtn.innerHTML = '&#8250;';
    nextBtn.setAttribute('aria-label', 'Next');

    // Horizontal scroll container
    var wrap = document.createElement('div');
    wrap.id = '_btgv_gi_wrap';
    var grid = document.createElement('div');
    grid.id = '_btgv_gi';

    // Page by the visible width on arrow click
    prevBtn.onclick = function () {
      wrap.scrollBy({ left: -wrap.clientWidth, behavior: 'smooth' });
    };
    nextBtn.onclick = function () {
      wrap.scrollBy({ left: wrap.clientWidth, behavior: 'smooth' });
    };

    // Show/hide arrows based on scroll position
    function updateArrows() {
      prevBtn.classList.toggle('hidden', wrap.scrollLeft <= 2);
      nextBtn.classList.toggle('hidden', wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 2);
    }
    wrap.addEventListener('scroll', updateArrows, { passive: true });

    // Build cells (supports mixed video + product items)
    vids.forEach(function (item, i) {
      var cell = document.createElement('div');
      cell.className = '_btgv_gc';
      var isProduct = item._type === 'product';

      if (isProduct) {
        if (item.image_url) {
          var pImg = document.createElement('img');
          pImg.src = item.image_url; pImg.alt = '';
          pImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block';
          cell.appendChild(pImg);
        }
      } else {
        // Photo posts (no s3_url) render their thumbnail as an <img>;
        // real videos lazy-load via dataset.src. Always show *something*
        // so the cell never sits empty.
        if (item.s3_url) {
          var video = document.createElement('video');
          video.dataset.src = item.s3_url;
          video.muted = true; video.loop = true;
          video.playsInline = true; video.preload = 'none';
          cell.appendChild(video);
          if (item.thumbnail_url) {
            // Show thumbnail until video loads — avoids black flash
            var poster = document.createElement('img');
            poster.src = item.thumbnail_url;
            poster.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:0';
            poster.referrerPolicy = 'no-referrer';
            cell.appendChild(poster);
          }
        } else if (item.thumbnail_url) {
          var poster2 = document.createElement('img');
          poster2.src = item.thumbnail_url;
          poster2.alt = item.title || '';
          poster2.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block';
          poster2.referrerPolicy = 'no-referrer';
          cell.appendChild(poster2);
        }
      }

      var ov = document.createElement('div'); ov.className = '_btgv_gc_ov';
      cell.appendChild(ov);

      var tags = isProduct ? [item] : (item.video_product_tags || []);
      if (tags.length > 0) {
        var tag = tags[0];
        var price = parseFloat(tag.price || 0);

        var prod = document.createElement('div');
        prod.className = '_btgv_gc_prod';

        var pnm = document.createElement('div');
        pnm.className = '_btgv_gc_prod_nm';
        pnm.textContent = tag.product_name + (!isProduct && tags.length > 1 ? '  +' + (tags.length - 1) + ' more' : '');
        prod.appendChild(pnm);

        if (price > 0) {
          var ppr = document.createElement('div');
          ppr.className = '_btgv_gc_prod_pr';
          ppr.textContent = '$' + price.toFixed(2);
          prod.appendChild(ppr);
        }

        var pbtns = document.createElement('div');
        pbtns.className = '_btgv_gc_prod_btns';

        function cellBtn(cls, icon, lbl, fn) {
          var btn = document.createElement('button');
          btn.className = '_btgv_gc_prod_btn ' + cls;
          btn.innerHTML = '<span>' + icon + '</span><span>' + lbl + '</span>';
          btn.onclick = function (e) { e.stopPropagation(); fn(btn); };
          return btn;
        }
        var trackId = isProduct ? (item._videoId || '') : item.id;

        pbtns.appendChild(cellBtn('_btgv_gc_pb_cart', '🛒', 'Cart', function (btn) {
          track(trackId, 'add_to_cart', tag.shopify_product_id);
          addToCart(tag.shopify_variant_id, function (ok) {
            fireConfetti();
            if (ok) {
              btn.innerHTML = '<span>✓</span><span>Added</span>';
              setTimeout(function () { btn.innerHTML = '<span>🛒</span><span>Cart</span>'; }, 2500);
            }
          });
        }));

        pbtns.appendChild(cellBtn('_btgv_gc_pb_buy', '⚡', 'Buy', function () {
          track(trackId, 'add_to_cart', tag.shopify_product_id);
          addToCart(tag.shopify_variant_id, function (ok) {
            if (ok) { fireConfetti(); window.location.href = '/checkout'; }
          });
        }));

        pbtns.appendChild(cellBtn('_btgv_gc_pb_neg', '🤝', 'Negotiate', function () {
          track(trackId, 'negotiate', tag.shopify_product_id);
          _btgvStartChatNegotiation(tag);
        }));

        prod.appendChild(pbtns);
        cell.appendChild(prod);
      }

      cell.onclick = function () { openFeed(i, vids); };
      grid.appendChild(cell);
    });

    wrap.appendChild(grid);
    outer.appendChild(prevBtn);
    outer.appendChild(wrap);
    outer.appendChild(nextBtn);
    container.appendChild(outer);

    // Lazy load + autoplay — IO root is the horizontal scroll wrapper
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target.querySelector('video');
        if (!v) return;
        if (e.isIntersecting) {
          if (v.dataset.src && !v.src) { v.src = v.dataset.src; }
          v.play().catch(function () {});
        } else {
          v.pause();
        }
      });
    }, {
      root: wrap,           // observe relative to horizontal scroll container
      rootMargin: '0px 40px 0px 40px', // pre-load 1 cell ahead
      threshold: 0.1
    });

    grid.querySelectorAll('._btgv_gc').forEach(function (c) { io.observe(c); });

    // Enforce 9:16 cell height in JS — CSS aspect-ratio is unreliable on flex children
    // inside overflow:auto containers in some browsers/themes.
    function fixCellHeights() {
      var cells = grid.querySelectorAll('._btgv_gc');
      if (!cells.length) return;
      var w = cells[0].getBoundingClientRect().width;
      if (w > 0) cells.forEach(function (c) { c.style.height = Math.round(w * 16 / 9) + 'px'; });
    }
    // setTimeout lets the browser finish painting before we measure
    setTimeout(function () { updateArrows(); fixCellHeights(); }, 60);
    window.addEventListener('resize', fixCellHeights, { passive: true });
  }

  // ─── TikTok feed ────────────────────────────────────────────────────────────
  function openFeed(startIdx, vids) {
    if (feedEl) { feedEl.remove(); feedEl = null; }
    feedEl = document.createElement('div');
    feedEl.id = '_btgv_feed';
    document.body.appendChild(feedEl);

    var closeBtn = document.createElement('button');
    closeBtn.id = '_btgv_close'; closeBtn.innerHTML = '&#x2715;';
    closeBtn.onclick = function () { closeFeed(); };
    feedEl.appendChild(closeBtn);

    // Build context once: brand info + bot avatar + max-discount-pct from
    // /widget/config (cached by rtGetConfig). Used by every slide for the
    // top brand badge, the "as low as" price hint, and the concierge bubble.
    var feedContext = {
      brandName: (_rtCfg && _rtCfg.brand_name) || null,
      brandLogo: (_rtCfg && _rtCfg.brand_logo) || null,
      brandHandle: (_rtCfg && _rtCfg.brand_handle) || null,
      brandUrl: (_rtCfg && _rtCfg.brand_url) || null,
      botAvatar: (_rtCfg && _rtCfg.bot_avatar_url) || null,
      maxDiscount: (_rtCfg && _rtCfg.max_discount_pct) != null ? _rtCfg.max_discount_pct : 20,
    };

    var muted = false;

    var scroll = document.createElement('div');
    scroll.id = '_btgv_scroll';
    feedEl.appendChild(scroll);

    // Concierge moved into the per-slide right rail (last item, below mute).
    // The previous floating bottom-left bubble was hard to reach on mobile
    // and conflicted with other UI. See the rail-build code in the slide
    // loop below for the actual button.

    // FOMO activity toast — feed-level, cycles real recent activity.
    // Stored on feedEl so closeFeed() can clean up the interval.
    var fomo = buildFomoSystem(feedEl, API_KEY);
    feedEl._fomo = fomo;

    // If rtGetConfig hasn't completed yet (fast page load), fetch it now
    // and patch the in-flight context so the brand badge + price hint
    // appear once data lands. Idempotent — rtGetConfig caches.
    if (!_rtCfg) {
      rtGetConfig(function (cfg) {
        if (!feedEl || !cfg) return;
        feedContext.brandName = cfg.brand_name || feedContext.brandName;
        feedContext.brandLogo = cfg.brand_logo || feedContext.brandLogo;
        feedContext.brandHandle = cfg.brand_handle || feedContext.brandHandle;
        feedContext.brandUrl = cfg.brand_url || feedContext.brandUrl;
        feedContext.botAvatar = cfg.bot_avatar_url || feedContext.botAvatar;
        feedContext.maxDiscount = cfg.max_discount_pct != null ? cfg.max_discount_pct : feedContext.maxDiscount;
        // Repaint top-bars + bubble + price hints with the fresh context
        feedEl.querySelectorAll('._btgv_topbar').forEach(function (b) { b.remove(); });
        feedEl.querySelectorAll('._btgv_bzone').forEach(function (b) { b.remove(); });
        feedEl.querySelectorAll('._btgv_slide').forEach(function (slide, idx) {
          var v = vids[idx];
          if (!v || v._type === 'product') return;
          slide.appendChild(buildTopBar(v, feedContext));
          slide.appendChild(buildBottomZone(v, v.video_product_tags || [], feedContext));
        });
        // Concierge avatar lives in each slide's rail now — a deep-link
        // arrival doesn't currently rebuild the rail, so we leave existing
        // rails intact. Future click still triggers rtGetConfig before the
        // chat opens.
      });
    }

    vids.forEach(function (item, i) {
      // Product card slide
      if (item._type === 'product') {
        scroll.appendChild(buildProductSlide(item, feedContext));
        return;
      }

      // Video slide
      var vid = item;
      var slide = document.createElement('div');
      slide.className = '_btgv_slide';

      // IG photo posts (and any video missing s3_url) render as a static
      // image using thumbnail_url. The original code always created a
      // <video> element, which set src="null" for these and showed a
      // black screen. The intersection-observer auto-advance still works
      // since img has no onended; we move to the next slide on a timer.
      var hasVideo = !!vid.s3_url;
      var video;
      if (hasVideo) {
        video = document.createElement('video');
        video.dataset.src = vid.s3_url;
        video.muted = muted; video.loop = false;
        video.playsInline = true; video.preload = 'none';
        video.onended = function () {
          var next = scroll.children[i + 1];
          if (next) next.scrollIntoView({ behavior: 'smooth' });
          else closeFeed();
        };
      } else if (vid.thumbnail_url) {
        // Photo posts: render the IG thumbnail as <img>. Use object-fit:
        // contain so landscape/square product photos aren't cropped to
        // show only half the outfit — the customer needs to see the
        // whole product. Letterbox bars on the sides of non-9:16 sources
        // are an acceptable trade for product visibility.
        video = document.createElement('img');
        video.src = vid.thumbnail_url;
        video.alt = vid.title || '';
        video.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;background:#000;';
        video.loading = 'lazy';
        video.referrerPolicy = 'no-referrer'; // Instagram CDN refuses non-IG referrers sometimes
      } else {
        // No s3_url AND no thumbnail — render a soft placeholder so the
        // slide isn't pure black.
        video = document.createElement('div');
        video.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.4);font-size:13px;background:linear-gradient(135deg,#1a1a2e,#0f0f1e);';
        video.textContent = 'No preview available';
      }

      var grad = document.createElement('div'); grad.className = '_btgv_grad';

      // Thin video progress bar (top edge) — updates as video plays
      var progress = document.createElement('div'); progress.className = '_btgv_progress';
      // Progress bar only meaningful for actual videos. For photo posts
      // (img element), keep it pinned at 100% so the bar doesn't sit empty.
      if (hasVideo) {
        video.addEventListener('timeupdate', function () {
          if (!video.duration) return;
          progress.style.width = ((video.currentTime / video.duration) * 100) + '%';
        });
      } else {
        progress.style.width = '100%';
      }

      // Top bar: brand badge + view count pill
      var topbar = buildTopBar(vid, feedContext);

      var rail = document.createElement('div'); rail.className = '_btgv_rail';
      var likeCount = vid.likes_count || 0;
      var likeBtn = document.createElement('button');
      likeBtn.style.position = 'relative'; // anchor for explosion hearts
      likeBtn.innerHTML = '<span style="font-size:22px">🤍</span><span>' + fmtCount(likeCount) + '</span>';

      // Explode 5 small hearts outward from the button on every tap. They
      // shoot in random radial directions and fade out in 700ms.
      function explodeHeartsFromButton(btn) {
        var dirs = [
          { x: -36, y: -42 }, { x: 0, y: -50 }, { x: 36, y: -42 },
          { x: -42, y: -10 }, { x: 42, y: -10 },
        ];
        var glyphs = ['❤', '❤', '💖', '💕', '🧡'];
        dirs.forEach(function (d, i) {
          var h = document.createElement('span');
          h.className = '_btgv_lh';
          h.textContent = glyphs[i % glyphs.length];
          h.style.color = i === 1 ? '#F72585' : '#fff';
          h.style.setProperty('--lhx', d.x + 'px');
          h.style.setProperty('--lhy', d.y + 'px');
          btn.appendChild(h);
          h.addEventListener('animationend', function () { h.remove(); });
        });
      }

      // Expose so the cross-user polled-stats path can also trigger
      // the explode animation on incoming likes.
      likeBtn._explode = function () { explodeHeartsFromButton(likeBtn); };

      function fireLike() {
        // Spring-pop on the button itself
        likeBtn.classList.remove('_btgv_popping');
        void likeBtn.offsetWidth;
        likeBtn.classList.add('_btgv_popping');
        setTimeout(function () { likeBtn.classList.remove('_btgv_popping'); }, 520);
        // Heart explosion outward from the button
        explodeHeartsFromButton(likeBtn);
        if (!likedSet[vid.id]) {
          likedSet[vid.id] = true;
          likeBtn.querySelectorAll('span')[0].textContent = '❤️';
          likeCount++;
          var countSpan = likeBtn.querySelectorAll('span')[1];
          countSpan.textContent = fmtCount(likeCount);
          // Brand-color flash on the count
          countSpan.classList.remove('_btgv_count_flash');
          void countSpan.offsetWidth;
          countSpan.classList.add('_btgv_count_flash');
          setTimeout(function () { countSpan.classList.remove('_btgv_count_flash'); }, 620);
          track(vid.id, 'like');
        }
      }
      likeBtn.onclick = function (e) { e.stopPropagation(); fireLike(); };

      var shareBtn = document.createElement('button');
      shareBtn.innerHTML = '<span style="font-size:20px">↗️</span><span>Share</span>';
      shareBtn.onclick = function (e) {
        e.stopPropagation();
        track(vid.id, 'share');
        var shareUrlStr = window.location.href;
        try {
          var shareUrl = new URL(window.location.href);
          shareUrl.searchParams.set('btgv', vid.id);
          shareUrlStr = shareUrl.toString();
        } catch (_) {}
        if (navigator.share) {
          navigator.share({ url: shareUrlStr }).catch(function () {});
        } else {
          try { navigator.clipboard.writeText(shareUrlStr); } catch (_) {}
        }
      };
      // Comment button — use comments_count from API payload
      var cmtCount = vid.comments_count || 0;
      var cmtBtn = document.createElement('button');
      cmtBtn.innerHTML = '<span style="font-size:20px">💬</span><span>' + fmtCount(cmtCount) + '</span>';

      var cmtDrawer = buildCommentDrawer(vid.id, cmtCount, function (n) {
        cmtBtn.querySelectorAll('span')[1].textContent = fmtCount(n);
      });
      slide.appendChild(cmtDrawer);

      cmtBtn.onclick = function (e) { e.stopPropagation(); cmtDrawer.open(); };

      // Save bookmark — persists to localStorage now (no backend yet),
      // shows filled bookmark when this video is saved.
      var savedSet = (function () {
        try {
          var raw = localStorage.getItem('_btgv_saves_' + API_KEY);
          return raw ? JSON.parse(raw) : {};
        } catch (_) { return {}; }
      })();
      var saveBtn = document.createElement('button');
      var isSaved = !!savedSet[vid.id];
      saveBtn.innerHTML = '<span style="font-size:20px">' + (isSaved ? '🔖' : '📑') + '</span><span>' + (isSaved ? 'Saved' : 'Save') + '</span>';
      saveBtn.onclick = function (e) {
        e.stopPropagation();
        savedSet[vid.id] = !savedSet[vid.id];
        try { localStorage.setItem('_btgv_saves_' + API_KEY, JSON.stringify(savedSet)); } catch (_) {}
        var nowSaved = !!savedSet[vid.id];
        saveBtn.innerHTML = '<span style="font-size:20px">' + (nowSaved ? '🔖' : '📑') + '</span><span>' + (nowSaved ? 'Saved' : 'Save') + '</span>';
        // Spring-pop on toggle for satisfying feedback
        saveBtn.classList.remove('_btgv_popping');
        void saveBtn.offsetWidth;
        saveBtn.classList.add('_btgv_popping');
        setTimeout(function () { saveBtn.classList.remove('_btgv_popping'); }, 520);
      };

      // Mute toggle in the rail (replaces the global #_btgv_mute button)
      var muteBtn = document.createElement('button');
      muteBtn.innerHTML = '<span style="font-size:18px">' + (muted ? '🔇' : '🔊') + '</span>';
      muteBtn.onclick = function (e) {
        e.stopPropagation();
        muted = !muted;
        // Update only the mute button on this slide; other slides update on their own next tap
        muteBtn.querySelectorAll('span').forEach(function (s) { s.textContent = muted ? '🔇' : '🔊'; });
        feedEl.querySelectorAll('._btgv_slide video').forEach(function (v) { v.muted = muted; });
      };

      // Concierge bot button — last in the rail (below mute) per merchant
      // request. Replaces the floating bottom-left bubble which was hard to
      // reach + conflicted with the mute icon. Avatar uses bot_avatar_url
      // from settings if available, else a generic chat icon.
      var concBtn = document.createElement('button');
      concBtn.style.position = 'relative';
      var concInner = '';
      if (feedContext.botAvatar) {
        concInner = '<span style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.12)"><img src="' + feedContext.botAvatar + '" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;display:block"/></span>';
      } else {
        concInner = '<span style="font-size:20px">💬</span>';
      }
      concBtn.innerHTML = concInner + '<span>Ask</span>';
      concBtn.onclick = function (e) {
        e.stopPropagation();
        // Pause the active video so the chat audio (if any) isn't fighting it
        var activeV = feedEl.querySelector('._btgv_slide video');
        if (activeV && !activeV.paused) { try { activeV.pause(); } catch (_) {} }
        // Close the feed first — concierge z-index (99997) is below the
        // feed (99999), so opening it without closing leaves the chat
        // hidden behind the feed.
        try { if (typeof closeFeed === 'function') closeFeed(); } catch (_) {}
        setTimeout(function () {
          try { if (typeof openConcierge === 'function') openConcierge(); } catch (_) {}
        }, 300);
      };

      rail.appendChild(likeBtn); rail.appendChild(cmtBtn); rail.appendChild(shareBtn); rail.appendChild(saveBtn); rail.appendChild(muteBtn); rail.appendChild(concBtn);

      slide._btgv_likeBtn = likeBtn;
      slide.appendChild(video);
      slide.appendChild(grad);
      slide.appendChild(progress);
      slide.appendChild(topbar);
      slide.appendChild(rail);
      var tags = vid.video_product_tags || [];
      slide.appendChild(buildBottomZone(vid, tags, feedContext));

      // Double-tap-to-like (Instagram pattern) — heart bursts at tap point.
      attachDoubleTapToLike(slide, fireLike);

      scroll.appendChild(slide);
    });

    // Lazy load per slide as it scrolls into view; update deep-link URL
    var currentSlideEl = null;

    function pollSlideStats(slideEl, item) {
      if (!item || item._type === 'product') return;
      fetch(API_BASE + '/api/widget/videos/' + item.id + '/stats')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !slideEl.isConnected) return;
          // Update view badge
          var vEl = slideEl.querySelector('._btgv_views span');
          if (vEl && d.views_count != null) { item.views_count = d.views_count; vEl.textContent = fmtCount(d.views_count); }
          // Update like count — spawn hearts + pop animation if increased.
          // Trigger the spring-pop AND explode hearts on the button so
          // cross-user likes get the same visual punch as own clicks.
          var likeBtn = slideEl._btgv_likeBtn;
          var likeSpan = likeBtn ? likeBtn.querySelectorAll('span')[1] : null;
          if (likeSpan && d.likes_count != null) {
            var prevLikes = item._polledLikes;
            if (prevLikes != null && d.likes_count > prevLikes) {
              spawnHeart();
              likeBtn.classList.remove('_btgv_popping');
              void likeBtn.offsetWidth;
              likeBtn.classList.add('_btgv_popping');
              setTimeout(function () { likeBtn.classList.remove('_btgv_popping'); }, 520);
              // Inline burst of small hearts from the rail like button
              if (likeBtn._explode) likeBtn._explode();
              // Brand-color count flash
              likeSpan.classList.remove('_btgv_count_flash');
              void likeSpan.offsetWidth;
              likeSpan.classList.add('_btgv_count_flash');
              setTimeout(function () { likeSpan.classList.remove('_btgv_count_flash'); }, 620);
            }
            item._polledLikes = d.likes_count;
            likeSpan.textContent = fmtCount(d.likes_count);
          }
          // Update comment button count — comment button is 2nd in rail
          var cmtSpan = slideEl.querySelector('._btgv_rail button:nth-child(2) span:last-child');
          if (cmtSpan && d.comments_count != null) { cmtSpan.textContent = fmtCount(d.comments_count); }
        })
        .catch(function () {});
    }

    // Aggressive preload throttling: only the active slide + 1 ahead get
    // the video src set. Slides further away keep preload="none". This
    // prevents the storefront from juggling 12 parallel video downloads
    // and stuttering on slower connections. Photo-post slides (img-based)
    // skip these calls — they're already loaded inline.
    function ensureVideoLoaded(slide) {
      if (!slide) return;
      var v = slide.querySelector('video');
      if (v && v.dataset.src && !v.src) v.src = v.dataset.src;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var idx = Array.from(scroll.children).indexOf(entry.target);
        var item = idx >= 0 ? vids[idx] : null;
        var v = entry.target.querySelector('video'); // null for photo-post slides
        if (entry.isIntersecting) {
          if (v) {
            ensureVideoLoaded(entry.target);
            // Preload the next slide so scroll-down feels instant
            ensureVideoLoaded(scroll.children[idx + 1]);
            v.play().catch(function () {});
          }
          // Pause every other video — defensive against fast scroll where
          // multiple slides are momentarily intersecting.
          scroll.querySelectorAll('._btgv_slide video').forEach(function (otherV) {
            if (otherV !== v) otherV.pause();
          });
          if (item && item._type !== 'product') {
            pushDeepLink(item.id);
            track(item.id, 'view');
            // Update view badge immediately (optimistic) — element lives
            // inside the new top-bar via _btgv_views span
            var vEl = entry.target.querySelector('._btgv_views span');
            if (vEl) { item.views_count = (item.views_count || 0) + 1; vEl.textContent = fmtCount(item.views_count); }
            // Fast-poll this slide every 3s for live counts from other users
            currentSlideEl = entry.target;
            clearInterval(pollTimer);
            item._polledLikes = item.likes_count || 0;
            pollSlideStats(entry.target, item);
            pollTimer = setInterval(function () { pollSlideStats(entry.target, item); }, 3000);
          }
        } else {
          if (v) v.pause();
          if (entry.target === currentSlideEl) { clearInterval(pollTimer); pollTimer = null; }
        }
      });
    }, { threshold: 0.6 });
    scroll.querySelectorAll('._btgv_slide').forEach(function (s) { io.observe(s); });

    function onKey(e) {
      if (e.key === 'Escape') { closeFeed(); document.removeEventListener('keydown', onKey); }
    }
    document.addEventListener('keydown', onKey);

    requestAnimationFrame(function () {
      feedEl.classList.add('open');
      var target = scroll.children[startIdx];
      if (target) target.scrollIntoView();
      if (vids[startIdx]) pushDeepLink(vids[startIdx].id);
    });
  }

  function closeFeed() {
    if (!feedEl) return;
    clearInterval(pollTimer); pollTimer = null;
    rtDisconnect();
    popDeepLink();
    if (feedEl._fomo && typeof feedEl._fomo.destroy === 'function') feedEl._fomo.destroy();
    feedEl.classList.remove('open');
    feedEl.querySelectorAll('video').forEach(function (v) { v.pause(); v.src = ''; });
    setTimeout(function () { if (feedEl) { feedEl.remove(); feedEl = null; } }, 280);
  }

  // ─── Cart deal banner + confetti ────────────────────────────────────────────
  function handleCartPage() {
    var deals = _btgvGetDeals();

    if (!deals.length) {
      // No active deals — still launch the concierge in cart mode
      injectStyles();
      buildLauncher([], []);
      return;
    }

    setTimeout(fireConfetti, 400);

    // ── Single consolidated banner — multi-item summary or single-item label ──
    var total = deals.reduce(function (s, d) { return s + (parseFloat(d.price) || 0); }, 0);
    var ckDest = null;
    for (var di = deals.length - 1; di >= 0; di--) {
      if (deals[di].invoiceUrl) { ckDest = deals[di].invoiceUrl; break; }
    }
    if (!ckDest) {
      for (var dj = deals.length - 1; dj >= 0; dj--) {
        if (deals[dj].checkoutUrl) { ckDest = deals[dj].checkoutUrl; break; }
      }
    }

    var bannerText;
    if (deals.length === 1) {
      var d0 = deals[0];
      bannerText = '🎁 Deal on <strong>' + (d0.productName || 'this item') +
        '</strong> — <strong>$' + d0.price + '</strong>';
    } else {
      bannerText = '🎁 <strong>' + deals.length + ' deals locked in</strong> — total <strong>$' + Math.round(total) + '</strong>';
    }

    var banner = document.createElement('div');
    banner.className = '_btgv_deal_banner';
    banner.style.cssText = [
      'position:fixed;left:0;right:0;top:0;z-index:2147483645;',
      'background:#111;color:#fff;font-family:system-ui,sans-serif;',
      'padding:11px 20px;display:flex;align-items:center;justify-content:center;',
      'gap:12px;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,.3);flex-wrap:wrap;'
    ].join('');

    var textEl = document.createElement('span');
    textEl.innerHTML = bannerText;
    var timerEl = document.createElement('span');
    timerEl.style.cssText = 'font-weight:700;font-variant-numeric:tabular-nums;color:#fbbf24;min-width:44px;';
    var closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:none;border:none;color:#666;font-size:18px;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;';
    closeBtn.innerHTML = '&times;';

    banner.appendChild(textEl);
    banner.appendChild(timerEl);
    if (ckDest) {
      var chkBtn = document.createElement('button');
      chkBtn.style.cssText = 'background:#16a34a;color:#fff;padding:7px 14px;border-radius:8px;font-weight:600;font-size:13px;border:none;cursor:pointer;white-space:nowrap;flex-shrink:0;';
      chkBtn.textContent = 'Checkout →';
      chkBtn.onclick = function () { _cncgCelebrateAndGo(ckDest); };
      banner.appendChild(chkBtn);
    }
    banner.appendChild(closeBtn);
    document.body.prepend(banner);

    var bannerH = banner.offsetHeight || 46;
    document.body.style.paddingTop = bannerH + 'px';

    closeBtn.onclick = function () {
      document.body.style.paddingTop = '0';
      banner.remove();
    };

    // Soonest-to-expire timer drives the countdown
    var earliestExp = deals.reduce(function (acc, d) {
      var exp = d.displayExpiresAt ? new Date(d.displayExpiresAt).getTime() : (Date.now() + 15 * 60 * 1000);
      return acc === null ? exp : Math.min(acc, exp);
    }, null) || (Date.now() + 15 * 60 * 1000);
    var tick = setInterval(function () {
      var remaining = Math.max(0, earliestExp - Date.now());
      var mins = Math.floor(remaining / 60000), secs = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      if (remaining <= 120000) timerEl.style.color = '#ef4444';
      if (remaining <= 0) {
        clearInterval(tick);
        timerEl.textContent = 'Expired';
        banner.style.background = '#333';
        var chk = banner.querySelector('a'); if (chk) chk.style.display = 'none';
      }
    }, 1000);

    // Spin up the concierge with a deal celebration greeting
    injectStyles();
    buildLauncher([], []);
    // Mark the concierge to open with a deal celebration instead of generic intro
    _btgCartDeals = deals;
  }

  var _btgCartDeals = null; // set by handleCartPage when active deals exist

  // ─── Floating launcher ───────────────────────────────────────────────────────
  function buildLauncher(feedItems, cols) {
    if (launcherEl) return;
    launcherEl = document.createElement('div');
    launcherEl.id = '_btgv_launcher';

    // Wrapper holds button + green badge dot
    var wrap = document.createElement('div');
    wrap.id = '_btgv_launcher_wrap';

    // Chat bubble SVG button
    var btn = document.createElement('button');
    btn.id = '_btgv_launcher_btn';
    btn.setAttribute('aria-label', 'Open shopping assistant');
    btn.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';

    // Green online badge
    var badge = document.createElement('div');
    badge.className = '_btgv_lbadge';

    wrap.appendChild(btn);
    wrap.appendChild(badge);
    launcherEl.appendChild(wrap);

    launcherEl.onclick = function () {
      if (_cncgOpen) { closeConcierge(); } else { openConcierge(); }
    };

    document.body.appendChild(launcherEl);
    buildConcierge(feedItems, cols);

    // Auto-open: immediately for deal celebrations, 800ms for product nego pages,
    // 3s default for first-time visitors (one auto-open per session — once it fires,
    // the gate stays set even if the customer closes the chat, so we don't re-pop).
    var _autoDelay = AUTO_OPEN_DELAY;
    var _AUTOOPEN_GATE = '_btgv_autoopen_fired_' + API_KEY;
    var _autoOpenAlreadyFired = false;
    try { _autoOpenAlreadyFired = !!sessionStorage.getItem(_AUTOOPEN_GATE); } catch (e) {}

    if (_btgCartDeals && _btgCartDeals.length) {
      _autoDelay = 600; // open promptly to show deal celebration
    } else {
      try {
        if (new URL(window.location.href).searchParams.get('btg_neg') === '1') _autoDelay = Math.min(_autoDelay, 800);
      } catch (e) {}
    }

    // Returning visitors who've already been auto-opened this session get to
    // browse uninterrupted — they can still tap the bubble.
    if (_autoOpenAlreadyFired) _autoDelay = -1;

    if (_autoDelay >= 0) {
      setTimeout(function () {
        if (!_cncgOpen) {
          try { sessionStorage.setItem(_AUTOOPEN_GATE, '1'); } catch (e) {}
          openConcierge();
        }
      }, _autoDelay);
    }
  }

  // ─── Concierge chat ──────────────────────────────────────────────────────────
  function buildConcierge(feedItems, cols) {
    if (_cncgEl) return;
    _cncgEl = document.createElement('div');
    _cncgEl.id = '_btgv_cncg';
    _cncgEl._feedItems = feedItems;
    _cncgEl._cols = cols || [];

    // If we're on a product page, pre-fetch the live Shopify product so the
    // opener can describe it (REP-style) and product-aware chips can answer
    // fabric/sizes/details without lag.
    if (_cncgGetPDPHandle()) _cncgFetchPDPProduct(function () {});

    // Apply per-merchant theme tokens if a theme arrived before mount
    if (window._btgvTheme) {
      _THEME_KEYS.forEach(function (k) {
        var v = window._btgvTheme[k];
        if (typeof v === 'string' && v) _cncgEl.style.setProperty('--btgv-' + k.replace(/_/g, '-'), v);
      });
    }

    // Shimmer
    var shim = document.createElement('div');
    shim.className = '_btgv_cncg_shim';
    _cncgEl.appendChild(shim);

    // Header
    var hdr = document.createElement('div'); hdr.className = '_btgv_cncg_hdr';
    var av = document.createElement('div'); av.className = '_btgv_cncg_av';
    if (BOT_AVATAR) { var avImg = document.createElement('img'); avImg.src = BOT_AVATAR; avImg.alt = ''; av.appendChild(avImg); }
    else { av.textContent = '🛍️'; }
    var dot = document.createElement('div'); dot.className = '_btgv_cncg_dot'; av.appendChild(dot);
    var nc = document.createElement('div'); nc.className = '_btgv_cncg_namecol';
    var t1 = document.createElement('div'); t1.className = '_btgv_cncg_title'; t1.textContent = BOT_NAME;
    var t2 = document.createElement('div'); t2.className = '_btgv_cncg_sub'; t2.textContent = BOT_SUBTITLE;
    nc.appendChild(t1); nc.appendChild(t2);
    var menuBtn = document.createElement('button'); menuBtn.className = '_btgv_cncg_menubtn'; menuBtn.innerHTML = '&#9776;';
    menuBtn.onclick = function (e) { e.stopPropagation(); _cncgToggleMenu(); };
    // Expand / fullscreen toggle — cycles: normal → expanded → fullscreen → normal
    var expandBtn = document.createElement('button'); expandBtn.className = '_btgv_cncg_expand';
    expandBtn.innerHTML = '&#x26F6;'; // ⛶
    expandBtn.title = 'Expand';
    (function () {
      var state = 0; // 0=normal, 1=expanded, 2=fullscreen
      var icons = ['&#x26F6;', '&#x2922;', '&#x2921;']; // ⛶ ↢ ↡
      expandBtn.onclick = function (e) {
        e.stopPropagation();
        state = (state + 1) % 3;
        _cncgEl.classList.remove('expanded', 'fullscreen');
        if (state === 1) { _cncgEl.classList.add('expanded'); expandBtn.title = 'Full screen'; }
        else if (state === 2) { _cncgEl.classList.add('fullscreen'); expandBtn.title = 'Restore'; }
        else { expandBtn.title = 'Expand'; }
        expandBtn.innerHTML = icons[state];
        if (_cncgEl._msgs) _cncgEl._msgs.scrollTop = _cncgEl._msgs.scrollHeight;
      };
    })();
    var xBtn = document.createElement('button'); xBtn.className = '_btgv_cncg_x'; xBtn.innerHTML = '&#x2715;';
    xBtn.onclick = function (e) { e.stopPropagation(); closeConcierge(); };
    hdr.appendChild(av); hdr.appendChild(nc); hdr.appendChild(menuBtn); hdr.appendChild(expandBtn); hdr.appendChild(xBtn);
    _cncgEl.appendChild(hdr);

    // Nav menu panel (hidden by default, overlays msgs)
    var menuPanel = document.createElement('div'); menuPanel.className = '_btgv_cncg_menupanel';
    var menuItems = [
      { icon: '🔄', label: 'New conversation', fn: function () { _cncgEl._msgs.innerHTML = ''; _cncgClearHistory(); _cncgEl._greeted = false; _cncgToggleMenu(); openConcierge(); } },
      { icon: '⭐', label: "What's recommended?", fn: function () { _cncgToggleMenu(); _cncgSend("What's recommended?", _cncgEl._msgs, _cncgEl._inp, _cncgEl._sendBtn); } },
      { icon: '🏷️', label: 'Promotions', fn: function () { _cncgToggleMenu(); _cncgPromotions(_cncgEl._msgs); } },
      { icon: '📦', label: 'Track my order', fn: function () { _cncgToggleMenu(); _cncgTrackOrder(_cncgEl._msgs); } },
      { icon: '💬', label: 'Recent conversations', fn: function () { _cncgToggleMenu(); _cncgRecentConvs(_cncgEl._msgs); } },
      { icon: '🛒', label: 'View cart', fn: function () { closeConcierge(); window.location.href = '/cart'; } },
      { icon: '💳', label: 'Checkout', fn: function () { closeConcierge(); window.location.href = '/checkout'; } },
    ];
    menuItems.forEach(function (m) {
      var item = document.createElement('div'); item.className = '_btgv_cncg_menuitem';
      var ic = document.createElement('span'); ic.className = '_btgv_cncg_menuitem_icon'; ic.textContent = m.icon;
      var lb = document.createElement('span'); lb.textContent = m.label;
      item.appendChild(ic); item.appendChild(lb);
      item.onclick = function (e) { e.stopPropagation(); m.fn(); };
      menuPanel.appendChild(item);
    });
    _cncgEl.appendChild(menuPanel);
    _cncgEl._menuPanel = menuPanel;

    // Messages
    var msgs = document.createElement('div'); msgs.className = '_btgv_cncg_msgs';
    _cncgEl.appendChild(msgs);
    _cncgEl._msgs = msgs;

    // Restore prior conversation from localStorage (same session, within 30 min)
    var _priorMsgs = _cncgGetMsgHistory();
    if (_priorMsgs.length) {
      // Divider so user knows this is restored history
      var divider = document.createElement('div');
      divider.style.cssText = 'text-align:center;font-size:10px;color:rgba(255,255,255,.25);padding:6px 0 2px;letter-spacing:0.04em;';
      divider.textContent = '— earlier in this session —';
      msgs.appendChild(divider);
      _priorMsgs.forEach(function (m) {
        var el = document.createElement('div');
        el.className = m.r === 'u' ? '_btgv_cncg_usr' : '_btgv_cncg_bot';
        el.style.opacity = '0.6';
        el.textContent = m.t;
        msgs.appendChild(el);
        // Rebuild LLM history context
        _cncgHistory.push({ role: m.r === 'u' ? 'user' : 'assistant', content: m.t });
      });
      // Mark greeted so we don't replay the intro, but allow new context (product page etc.)
      _cncgEl._greeted = true;
    }

    // Input row — always visible
    var inputrow = document.createElement('div'); inputrow.className = '_btgv_cncg_inputrow';
    var inp = document.createElement('input');
    inp.type = 'text'; inp.className = '_btgv_cncg_inp';
    inp.placeholder = 'Ask me anything…'; inp.maxLength = 300;
    var sendBtn = document.createElement('button');
    sendBtn.className = '_btgv_cncg_send'; sendBtn.innerHTML = '&#x27A4;'; sendBtn.disabled = true;
    inp.addEventListener('input', function () { sendBtn.disabled = !inp.value.trim(); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && inp.value.trim()) _cncgSend(inp.value.trim(), msgs, inp, sendBtn);
    });
    sendBtn.onclick = function (e) {
      e.stopPropagation();
      if (inp.value.trim()) _cncgSend(inp.value.trim(), msgs, inp, sendBtn);
    };
    inputrow.appendChild(inp); inputrow.appendChild(sendBtn);
    _cncgEl.appendChild(inputrow);
    _cncgEl._inp = inp; _cncgEl._sendBtn = sendBtn;

    document.body.appendChild(_cncgEl);

    // Rehydrate server thread so we know if this is a returning visitor.
    // Decides whether the chat shows the first-time intro+capture flow or
    // jumps straight to the warm "welcome back" greeting.
    try {
      var sessId = _getOrInitSessionId();
      fetch(API_BASE + '/api/concierge/thread/' + encodeURIComponent(sessId) + '?k=' + encodeURIComponent(API_KEY))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (_cncgEl && d) _cncgEl._thread = d;
        })
        .catch(function () {});
    } catch (e) {}

    // Eagerly load Shopify catalog so handle resolution works for ALL product clicks
    // (not just after the user runs the "Get me a deal" flow)
    if (!_cncgEl._shopifyProducts) {
      fetch('/products.json?limit=250')
        .then(function (r) { return r.ok ? r.json() : { products: [] }; })
        .then(function (d) { if (_cncgEl) _cncgEl._shopifyProducts = d.products || []; })
        .catch(function () { if (_cncgEl) _cncgEl._shopifyProducts = []; });
    }
  }

  // ── Detect what page the shopper is on ──────────────────────────────────────
  function _getPageContext() {
    var path = window.location.pathname;
    var ctx = { type: 'home', title: null, extra: null };

    var productMatch = path.match(/\/products\/([^/?#]+)/);
    var collectionMatch = path.match(/\/collections\/([^/?#]+)/);

    if (productMatch) {
      ctx.type = 'product';
      // Try meta tag first, then h1
      var ogTitle = document.querySelector('meta[property="og:title"]');
      var h1 = document.querySelector('h1');
      ctx.title = (ogTitle && ogTitle.content) ? ogTitle.content.split('–')[0].split('|')[0].trim()
        : (h1 ? h1.textContent.trim() : null);
      // Try to get price
      var priceEl = document.querySelector('[class*="price"]:not([class*="compare"]):not([class*="was"])');
      ctx.extra = priceEl ? priceEl.textContent.trim().replace(/\s+/g, ' ') : null;
    } else if (collectionMatch) {
      ctx.type = 'collection';
      var h1c = document.querySelector('h1');
      ctx.title = h1c ? h1c.textContent.trim() : collectionMatch[1].replace(/-/g, ' ');
    } else if (path === '/cart' || path.indexOf('/cart') === 0) {
      ctx.type = 'cart';
    }

    return ctx;
  }

  function _buildContextGreeting(ctx) {
    var profile = _cncgGetProfile();
    var hasHistory = _cncgGetMsgHistory().length > 0;
    var returning = hasHistory && profile.viewedProducts && profile.viewedProducts.length;

    // If the user has active deals, lead with those — keeps the conversation moving toward checkout
    var activeDeals = (typeof _btgvGetDeals === 'function') ? _btgvGetDeals() : [];
    if (activeDeals.length) {
      if (activeDeals.length > 1) {
        var totalNeg = activeDeals.reduce(function (s, d) { return s + (parseFloat(d.price) || 0); }, 0);
        return "Picking up where we left off — you've got " + activeDeals.length + " deals locked in totaling $" + Math.round(totalNeg) + ". Want to keep shopping or head to checkout?";
      }
      var d0 = activeDeals[0];
      return "Welcome back! Your $" + Math.round(d0.price) + " deal on " + (d0.productName || 'your pick') + " is still locked in. Keep browsing or checkout?";
    }

    if (returning) {
      var last = profile.viewedProducts[0];
      var greetings = [
        'Welcome back! 🌟 Still thinking about ' + last.name + '? I can help you snag a better price — or find something you\'ll love even more.',
        'Hey, great to see you again! 👋 You were looking at ' + last.name + ' — want me to dig into the details or find you a deal?',
        'You\'re back! 🎉 I remember you were eyeing ' + last.name + '. I\'m here whenever you\'re ready.',
      ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    }

    if (ctx.type === 'product' && ctx.title) {
      // If the live PDP product was already fetched (chips pre-warmed it),
      // open with a REP-style description sentence — feels like a salesperson
      // who's looking at the dress with you.
      var pdp = (_cncgEl && _cncgEl._pdpProduct) || null;
      if (pdp) {
        var desc = _cncgCleanDesc(pdp.description || pdp.body_html || '');
        if (desc) {
          var firstSentence = desc.split(/(?<=[.!?])\s+/)[0];
          if (firstSentence && firstSentence.length > 30) {
            return '✨ ' + firstSentence + ' — would you like help confirming the fit, fabric, or styling for your event?';
          }
        }
      }
      var openers = [
        'Ooh, great choice! ✨ "' + ctx.title + '" is gorgeous' + (ctx.extra ? ' — ' + ctx.extra : '') + '. Want me to get you the best possible price?',
        'Nice taste! 😍 "' + ctx.title + '"' + (ctx.extra ? ' at ' + ctx.extra : '') + ' — I can check if there\'s a better deal waiting for you.',
        '"' + ctx.title + '" — solid pick! 👌' + (ctx.extra ? ' ' + ctx.extra + '.' : '') + ' I\'m here if you want to talk through it or get a deal.',
      ];
      return openers[Math.floor(Math.random() * openers.length)];
    }
    if (ctx.type === 'collection' && ctx.title) {
      var collOpeners = [
        'Love the ' + ctx.title + ' collection! 💫 Tell me what you\'re looking for and I\'ll find your perfect match.',
        'Browsing ' + ctx.title + '? Amazing pieces in here. What\'s catching your eye — I can help narrow it down!',
        'Great taste — you\'re in the right place. 🛍️ I know every item in ' + ctx.title + ', just ask!',
      ];
      return collOpeners[Math.floor(Math.random() * collOpeners.length)];
    }
    if (ctx.type === 'cart') {
      var deals = _btgvGetDeals();
      if (deals.length) return '🎉 Your deals are locked in! Ready to checkout, or want to keep finding more great pieces?';
      return 'Almost there! 🛒 Before you checkout — want me to see if I can get you a better price on anything in your cart?';
    }

    // Generic warm home/other page greetings
    var genericGreetings = [
      BOT_GREETING,
      'Hey there! 👋 I\'m your personal shopper — I know every product in this store, can negotiate prices, and I\'m here to make sure you find exactly what you\'re looking for.',
      'Hi! Great to have you here 🌟 I\'m not just a chatbot — I\'m a personal shopper. Ask me anything, or let me find you something amazing.',
    ];
    return genericGreetings[Math.floor(Math.random() * genericGreetings.length)];
  }

  // ─── Negotiated cart in concierge ────────────────────────────────────────────
  function _cncgShowNegCart(msgs) {
    var deals = _btgvGetDeals();
    if (!deals.length) {
      _cncgAddBot(msgs, "Hmm, I don't see any active deals. Want to negotiate something?");
      _cncgBackChip(msgs);
      return;
    }

    // If concierge was opened fresh (greeted = false), mark it greeted so we don't show generic intro
    if (_cncgEl && !_cncgEl._greeted) _cncgEl._greeted = true;

    var totalSaved = deals.reduce(function (sum, d) {
      return sum + (d.listPrice && d.price ? Math.round(d.listPrice - d.price) : 0);
    }, 0);
    var headerMsg = deals.length === 1
      ? '🎉 Deal done, darling! Your exclusive price is locked in:'
      : '🎉 Look at you — ' + deals.length + ' deals! You just saved $' + totalSaved + ' total. Ready to make it official?';
    _cncgAddBot(msgs, headerMsg, true);

    // Pick the best checkout URL: Draft Order invoice URL > discount-coded cart URL > /cart
    var checkoutUrl = null;
    for (var ci = deals.length - 1; ci >= 0; ci--) {
      if (deals[ci].invoiceUrl && deals[ci].invoiceUrl.indexOf('/checkout') >= 0) {
        checkoutUrl = deals[ci].invoiceUrl; break;
      }
    }
    if (!checkoutUrl) {
      // Fallback: items have been added to cart with a discount code — go to cart with code applied
      var lastCode = null;
      for (var di = deals.length - 1; di >= 0; di--) {
        if (deals[di].discountCode) { lastCode = deals[di].discountCode; break; }
      }
      checkoutUrl = lastCode ? '/cart?discount=' + encodeURIComponent(lastCode) : '/cart';
    }

    // Render deal cards
    var cardsWrap = document.createElement('div'); cardsWrap.className = '_btgv_neg_cart';
    deals.forEach(function (deal) {
      var card = document.createElement('div'); card.className = '_btgv_neg_cart_card';
      var saved = deal.listPrice && deal.price ? Math.round(deal.listPrice - deal.price) : 0;
      var savedPct = (saved > 0 && deal.listPrice) ? Math.round((saved / deal.listPrice) * 100) : 0;

      var info = document.createElement('div'); info.className = '_btgv_neg_cart_info';
      var nm = document.createElement('div'); nm.className = '_btgv_neg_cart_name';
      nm.textContent = deal.productName || 'Item';
      var pr = document.createElement('div'); pr.className = '_btgv_neg_cart_price';
      pr.innerHTML = '<span class="_btgv_neg_cart_deal">$' + Math.round(deal.price) + '</span>' +
        (deal.listPrice && deal.listPrice !== deal.price ? ' <span class="_btgv_neg_cart_orig">$' + Math.round(deal.listPrice) + '</span>' : '') +
        (savedPct > 0 ? ' <span class="_btgv_neg_cart_badge">' + savedPct + '% off</span>' : '');
      info.appendChild(nm); info.appendChild(pr);

      var rmBtn = document.createElement('button'); rmBtn.className = '_btgv_neg_cart_rm'; rmBtn.innerHTML = '&#x2715;';
      rmBtn.title = 'Remove deal';
      (function (d, cardEl, rmb) {
        rmb.onclick = function () {
          rmb.disabled = true; rmb.textContent = '…';
          fetch(API_BASE + '/api/draft-order/line-item', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ negotiation_id: d.negotiationId })
          })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              _btgvRemoveDeal(d.negotiationId);
              cardEl.remove();
              // Update checkout URL if we got a new invoice URL
              if (res.invoice_url) {
                checkoutUrl = res.invoice_url;
                var ckBtn = cardsWrap.parentNode && cardsWrap.parentNode.querySelector('._btgv_neg_cart_checkout');
                if (ckBtn) ckBtn.setAttribute('data-url', res.invoice_url);
              }
              var remaining = _btgvGetDeals();
              if (!remaining.length) {
                cardsWrap.remove();
                _cncgAddBot(msgs, 'Deal removed. Want to negotiate something else?');
                _cncgBackChip(msgs);
              }
            })
            .catch(function () { rmb.disabled = false; rmb.textContent = '✕'; });
        };
      })(deal, card, rmBtn);

      card.appendChild(info); card.appendChild(rmBtn);
      cardsWrap.appendChild(card);
    });

    setTimeout(function () {
      msgs.appendChild(cardsWrap);
      msgs.scrollTop = msgs.scrollHeight;

      // Checkout button — celebrate, then redirect
      var ckBtn = document.createElement('button'); ckBtn.className = '_btgv_neg_cart_checkout';
      ckBtn.textContent = '⚡ Checkout with my deals';
      ckBtn.setAttribute('data-url', checkoutUrl);
      ckBtn.onclick = function () {
        var url = ckBtn.getAttribute('data-url') || '/checkout';
        _cncgCelebrateAndGo(url);
      };

      var keepBtn = document.createElement('button'); keepBtn.className = '_btgv_cncg_chip';
      keepBtn.textContent = '🛍️ Keep shopping';
      keepBtn.onclick = function () { _cncgMainMenu(msgs); };

      var btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;gap:8px;flex-direction:column;padding:4px 0;';
      btnRow.appendChild(ckBtn); btnRow.appendChild(keepBtn);
      msgs.appendChild(btnRow);
      msgs.scrollTop = msgs.scrollHeight;
    }, 400);
  }

  function _cncgShowNegProductIntro(msgs) {
    var prod = _btgNegProduct;
    _cncgUpdateProfile({ viewedProduct: { name: prod.product_name, price: parseFloat(prod.price || 0).toFixed(2) } });

    // If user already negotiated this exact product, skip intro and show the deal
    var profile = _cncgGetProfile();
    var alreadyNegotiated = (profile.negotiated || []).find(function (n) { return n.name === prod.product_name; });
    if (alreadyNegotiated) {
      setTimeout(function () {
        _cncgAddBot(msgs, '👋 You already locked in ' + prod.product_name + ' for $' + alreadyNegotiated.dealPrice + '. Want to checkout, or shall we find something else amazing?', true);
        _cncgShowNegCart(msgs);
      }, 300);
      return;
    }

    var price = parseFloat(prod.price || 0);
    var compareAt = parseFloat(prod.compare_at_price || 0);
    var priceStr = price > 0 ? '$' + price.toFixed(2) : '';
    var discountStr = '';
    if (compareAt > price && price > 0) {
      discountStr = ' (already ' + Math.round((1 - price / compareAt) * 100) + '% off!)';
    }
    setTimeout(function () {
      _cncgAddBot(msgs, '👀 ' + prod.product_name + (priceStr ? ' — ' + priceStr + discountStr : '') + '. Want me to push for an even better price?', true);
    }, 300);
    setTimeout(function () {
      var negProd = prod;
      _cncgAddChips(msgs, [
        { label: '🤝 Push for a better price', fn: function () { _btgvStartChatNegotiation(negProd, msgs); }},
        { label: '🛒 Add to cart at ' + (priceStr || 'list price'), fn: function () {
          var vid = negProd.variant_id;
          if (!vid) return;
          addToCart(vid, function (ok) {
            if (ok) { fireConfetti(); _cncgAddBot(msgs, '✓ Added to cart! Ready to checkout?'); _cncgAddChips(msgs, [{ label: '⚡ Go to checkout', fn: function () { window.location.href = '/checkout'; } }]); }
          });
        }},
        { label: '🔍 Show me similar items', fn: function () { _cncgFind(msgs); }},
      ]);
    }, 1000);
  }

  // ── Page-context openers — 3 variants per page type, lots of emojis ──
  // Bot identity uses BOT_NAME (defaults "Botiga", overridden by
  // merchant_settings.bot_name or data-bot-name attribute). Hardcoding
  // a name here would conflict with merchants whose store name happens
  // to match the default.
  function _willowOpenerPool(pageType) {
    var name = BOT_NAME || 'your concierge';
    var pools = {
      home: [
        { intro: "Hey, I'm " + name + " 👋 your shopping concierge ✨", hook: "🔥 Today's drop:" },
        { intro: "Hi! ✨ I'm " + name + " — I know every product in here and can negotiate any price.", hook: "💎 Today's hottest pick:" },
        { intro: "Hey there 👋 " + name + " here, your shopping bestie 🛍️", hook: "🎁 Drop of the day:" },
      ],
      product: [
        { intro: "Spotted you on this one 👀 I'm " + name + ", your shopping concierge ✨", hook: "🔓 I can probably do better than that price for you:" },
        { intro: "Hey! 👋 I'm " + name + " — I see you're checking this out.", hook: "💸 Let me get you a number you'll like:" },
        { intro: "Curious about this? 🤔 I'm " + name + ", here to help you score it for less.", hook: "🤝 Real talk on price:" },
      ],
      collection: [
        { intro: "Browsing this collection? 🔥 I'm " + name + ", your shopping concierge ✨", hook: "💎 Hottest in here today:" },
        { intro: "Hey 👋 " + name + " here. Great taste — this collection is fire 🔥", hook: "🎁 Pick of the bunch:" },
        { intro: "Loving the vibe? 😍 I'm " + name + ", I know every piece in this collection.", hook: "🔓 Today's standout:" },
      ],
      cart: [
        { intro: "Big bag energy 🛍️ I'm " + name + " — let me knock the total down for you ✨", hook: "💸 Try this one first:" },
        { intro: "Hold up! 🤝 " + name + " here. I can probably get you a deal before checkout.", hook: "🔥 Best move right now:" },
        { intro: "Ready to checkout? 🛒 Wait — I'm " + name + ", let me save you some 💸", hook: "🎁 Quick win:" },
      ],
    };
    return pools[pageType] || pools.home;
  }

  function _pickWillowOpener(pageType) {
    var pool = _willowOpenerPool(pageType);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Pick the deepest discount product from the catalog as Willow's hook.
  // Falls back to the first Shopify product if no compare_at_price set
  // (better than a generic message — Willow always names something).
  function _pickWillowDealProduct(cb) {
    _fetchCollectionDealsCatalog(function (catalog) {
      var pool = (catalog.products || []).filter(function (p) { return p.available !== false; });
      if (!pool.length) pool = catalog.products || [];

      var withDiscount = pool.filter(function (p) {
        var price = parseFloat(p.price);
        var compareAt = parseFloat(p.compare_at_price);
        return Number.isFinite(price) && Number.isFinite(compareAt) && compareAt > price;
      });

      if (withDiscount.length) {
        withDiscount.sort(function (a, b) {
          var spreadA = parseFloat(a.compare_at_price) - parseFloat(a.price);
          var spreadB = parseFloat(b.compare_at_price) - parseFloat(b.price);
          return spreadB - spreadA;
        });
        cb(withDiscount[0]);
        return;
      }

      // No on-sale items — use highest collection score (new / featured / best-seller)
      pool.sort(function (a, b) { return (b.collection_score || 0) - (a.collection_score || 0); });
      cb(pool[0] || null);
    });
  }

  // ── Email capture tile with blurred-price reveal ────────────────────────────
  // Renders a styled inline card in the chat. After successful email submit,
  // animates the blurred number → real number, then offers Negotiate (uses
  // the existing per-product negotiation flow — no duplication).
  function _renderWillowDealTile(msgs, deal, hookLine) {
    if (!deal) return null;

    var tile = document.createElement('div');
    tile.className = '_btgv_willow_deal_tile';
    tile.style.cssText = 'background:linear-gradient(135deg,#0f172a,#1e1b4b);color:#fff;border-radius:14px;padding:14px;margin:8px 0;box-shadow:0 6px 20px rgba(0,0,0,0.18);font-family:inherit;';

    var hook = document.createElement('div');
    hook.style.cssText = 'font-size:12px;color:#c7d2fe;font-weight:600;letter-spacing:0.3px;margin-bottom:10px;';
    hook.textContent = hookLine || '🔓 Today\'s drop';
    tile.appendChild(hook);

    var card = document.createElement('div');
    card.style.cssText = 'display:flex;gap:12px;align-items:center;';
    if (deal.image_url) {
      var img = document.createElement('img');
      img.src = deal.image_url; img.alt = '';
      img.style.cssText = 'width:64px;height:64px;border-radius:10px;object-fit:cover;flex-shrink:0;';
      card.appendChild(img);
    }
    var info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';

    var name = document.createElement('div');
    name.style.cssText = 'font-size:13px;font-weight:700;line-height:1.3;margin-bottom:4px;';
    name.textContent = deal.product_name || deal.title || 'Today\'s pick';
    info.appendChild(name);

    var priceRow = document.createElement('div');
    priceRow.style.cssText = 'display:flex;align-items:baseline;gap:8px;font-size:14px;';

    var compareAt = parseFloat(deal.compare_at_price);
    var price = parseFloat(deal.price);
    if (Number.isFinite(compareAt) && compareAt > price) {
      var was = document.createElement('span');
      was.style.cssText = 'color:#94a3b8;text-decoration:line-through;font-size:13px;';
      was.textContent = '$' + Math.round(compareAt);
      priceRow.appendChild(was);
    }
    var priceNow = document.createElement('span');
    priceNow.className = '_btgv_willow_price';
    priceNow.style.cssText = 'font-size:18px;font-weight:800;color:#fff;filter:blur(8px);transition:filter 0.6s cubic-bezier(.34,1.56,.64,1);user-select:none;';
    priceNow.textContent = '$' + Math.round(price);
    priceRow.appendChild(priceNow);
    info.appendChild(priceRow);

    var lockHint = document.createElement('div');
    lockHint.className = '_btgv_willow_lock_hint';
    lockHint.style.cssText = 'font-size:11px;color:#a5b4fc;margin-top:4px;';
    lockHint.textContent = '🔒 Locked — drop email below';
    info.appendChild(lockHint);

    card.appendChild(info);
    tile.appendChild(card);

    var form = document.createElement('div');
    form.className = '_btgv_willow_form';
    form.style.cssText = 'display:flex;gap:6px;margin-top:12px;';
    var input = document.createElement('input');
    input.type = 'email';
    input.placeholder = '📧 you@email.com';
    input.autocomplete = 'email';
    input.style.cssText = 'flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 12px;font-size:13px;color:#fff;outline:none;font-family:inherit;';
    var btn = document.createElement('button');
    btn.textContent = 'Unlock 🔓';
    btn.style.cssText = 'background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;';
    form.appendChild(input);
    form.appendChild(btn);
    tile.appendChild(form);

    var skip = document.createElement('button');
    skip.textContent = 'skip and just browse →';
    skip.style.cssText = 'background:none;border:none;color:#94a3b8;font-size:11px;margin-top:8px;cursor:pointer;font-family:inherit;display:block;';
    tile.appendChild(skip);

    msgs.appendChild(tile);
    msgs.scrollTop = msgs.scrollHeight;
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 100);

    function unlock(email) {
      var sessionId = _getOrInitSessionId();
      try { _btgvFireFunnelEvent('captured', { surface: 'willow_opener' }); } catch (_) {}
      try {
        fetch(API_BASE + '/api/concierge/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
          body: JSON.stringify({
            session_id: sessionId,
            source: 'concierge_arrival',
            capture_step: 'contact',
            email: email,
            product_url: deal.handle ? (window.location.origin + '/products/' + deal.handle) : window.location.href,
            product_name: deal.product_name || deal.title || null,
            list_price: Number.isFinite(parseFloat(deal.price)) ? parseFloat(deal.price) : null,
          }),
        });
      } catch (e) {}

      // Mirror as a user message so the dashboard transcript shows it
      _cncgSaveMsg('u', '📧 ' + email);
      _cncgSaveMsg('b', "Unlocked! 🔓");

      // Animate the blur off
      priceNow.style.filter = 'blur(0)';
      lockHint.textContent = '✓ Unlocked just for you ✨';
      lockHint.style.color = '#86efac';
      form.style.display = 'none';
      skip.style.display = 'none';

      setTimeout(function () {
        _cncgAddBot(msgs, '$' + Math.round(price) + ' yours if you want it 🎁 Want me to push for even better?');
      }, 700);
      setTimeout(function () {
        _cncgAddChips(msgs, _buildChips(msgs, [
          { label: '🤝 Negotiate this →', fn: function () { _navProductInNewTab(deal, true); } },
          { label: '🛍️ Show me more', fn: function () { _cncgDeals(msgs); } },
          { label: '🔍 Help me find something', fn: function () { _cncgFind(msgs); } },
        ]));
      }, 1200);
    }

    btn.addEventListener('click', function () {
      var email = (input.value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        input.style.borderColor = '#ef4444';
        return;
      }
      unlock(email);
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });

    skip.addEventListener('click', function () {
      tile.style.transition = 'opacity 0.3s, transform 0.3s';
      tile.style.opacity = '0';
      tile.style.transform = 'translateY(-6px)';
      setTimeout(function () { try { tile.remove(); } catch (e) {} }, 320);
      setTimeout(function () {
        _cncgAddBot(msgs, "No worries — I'm right here when you change your mind 😊");
        _cncgMainMenu(msgs);
      }, 380);
    });

    return tile;
  }

  // ── First-time Willow opener — 3 turns, typing-paced ────────────────────────
  function _runWillowFirstTimeOpener(msgs, ctx) {
    var opener = _pickWillowOpener(ctx.type);

    // Turn 1: warm intro
    setTimeout(function () { _cncgAddBot(msgs, opener.intro); }, 350);

    // Turn 2: deal hook + tile
    setTimeout(function () {
      _pickWillowDealProduct(function (deal) {
        if (!deal) {
          // Catalog empty — fall back to existing greeting flow
          _cncgAddBot(msgs, "Take a look around — tap me whenever you want a deal ✨");
          _cncgMainMenu(msgs);
          return;
        }
        _renderWillowDealTile(msgs, deal, opener.hook);
      });
    }, 1400);
  }

  function openConcierge() {
    if (!_cncgEl) return;
    _cncgOpen = true;
    requestAnimationFrame(function () { _cncgEl.classList.add('open'); });
    try { _btgvFireFunnelEvent('engaged', { surface: 'concierge_open' }); } catch (_) {}

    // Product page via ?btg_neg=1 — always show product context regardless of greeted state
    if (_btgNegProduct && !_cncgEl._negProductShown) {
      _cncgEl._negProductShown = true;
      _cncgShowNegProductIntro(_cncgEl._msgs);
      _cncgEl._greeted = true;
      return;
    }

    if (!_cncgEl._greeted) {
      _cncgEl._greeted = true;
      var msgs = _cncgEl._msgs;

      // Cart page after a deal — show full negotiated cart UI
      if (_btgCartDeals && _btgCartDeals.length) {
        setTimeout(function () { _cncgShowNegCart(msgs); }, 400);
        return;
      }

      var ctx = _getPageContext();
      var openingDeals = (typeof _btgvGetDeals === 'function') ? _btgvGetDeals() : [];

      // ── Returning visitor detection ─────────────────────────────────────────
      // Server thread is the source of truth (localStorage gets cleared, the
      // thread is durable). A visitor is "returning" if we have prior
      // captured email OR existing thread messages from a past session.
      var thread = _cncgEl._thread || null;
      var hasCapturedEmail = !!(thread && thread.contact && thread.contact.email);
      var hasPriorThread = !!(thread && thread.exists && thread.messages && thread.messages.length > 0);
      var isReturning = hasCapturedEmail || hasPriorThread || _cncgGetMsgHistory().length > 0;

      // Active deals always take priority (existing behavior)
      if (openingDeals.length) {
        setTimeout(function () { _cncgAddBot(msgs, _buildContextGreeting(ctx)); }, 300);
        setTimeout(function () {
          _cncgAddChips(msgs, _buildChips(msgs, [
            { label: '⚡ Checkout', fn: function () { _cncgCelebrateAndGo(_cncgPickCheckoutDest()); }},
            { label: '🛍️ Keep shopping', fn: function () { _cncgShowMoreOptions(); }}
          ]));
        }, 1100);
        return;
      }

      if (isReturning) {
        // Warm welcome-back — name if captured
        var name = thread && thread.contact && thread.contact.name ? thread.contact.name : null;
        var welcome = name
          ? 'Welcome back, ' + name + '! 👋✨ Ready to find something?'
          : (hasCapturedEmail
              ? "Welcome back 👋✨ Today's deals are ready when you are."
              : _buildContextGreeting(ctx));
        setTimeout(function () { _cncgAddBot(msgs, welcome); }, 300);
        setTimeout(function () { _cncgMainMenu(msgs); }, 1000);
        return;
      }

      // First-time visitor → three-turn opener with email capture
      _runWillowFirstTimeOpener(msgs, ctx);
    }
  }

  function closeConcierge() {
    if (!_cncgEl) return;
    _cncgOpen = false;
    _cncgEl.classList.remove('open', 'expanded', 'fullscreen');
  }

  // ── Nav menu toggle ──────────────────────────────────────────────────────────
  function _cncgToggleMenu() {
    if (!_cncgEl || !_cncgEl._menuPanel) return;
    _cncgEl._menuPanel.classList.toggle('open');
  }

  // ── Robust handle resolution: id match → exact name → fuzzy name ───────────
  function _resolveProductHandle(p) {
    var h = p.handle || p.product_handle || '';
    if (h) return h;
    if (!_cncgEl || !_cncgEl._shopifyProducts) return '';

    var sid = p.shopify_product_id || p.id;
    if (sid) {
      for (var i = 0; i < _cncgEl._shopifyProducts.length; i++) {
        if (String(_cncgEl._shopifyProducts[i].id) === String(sid)) {
          return _cncgEl._shopifyProducts[i].handle || '';
        }
      }
    }
    var name = (p.product_name || p.title || p.name || '').toLowerCase().trim();
    if (!name) return '';
    // Exact name match
    for (var j = 0; j < _cncgEl._shopifyProducts.length; j++) {
      if ((_cncgEl._shopifyProducts[j].title || '').toLowerCase().trim() === name) {
        return _cncgEl._shopifyProducts[j].handle || '';
      }
    }
    // Fuzzy: longest common name overlap
    var bestHandle = '', bestScore = 0;
    var nameWords = name.split(/\s+/).filter(function (w) { return w.length > 2; });
    if (!nameWords.length) return '';
    for (var k = 0; k < _cncgEl._shopifyProducts.length; k++) {
      var t = (_cncgEl._shopifyProducts[k].title || '').toLowerCase();
      var score = nameWords.reduce(function (s, w) { return s + (t.indexOf(w) >= 0 ? w.length : 0); }, 0);
      if (score > bestScore) { bestScore = score; bestHandle = _cncgEl._shopifyProducts[k].handle || ''; }
    }
    return bestScore >= 4 ? bestHandle : '';
  }

  // Always-new-tab navigator: handle → URL → search fallback (NEVER opens local modal)
  function _navProductInNewTab(p, withNeg) {
    var h = _resolveProductHandle(p);
    var qs = withNeg ? '?btg_neg=1' : '';
    if (h) { window.open('/products/' + h + qs, '_blank'); return true; }
    if (p.url) {
      var sep = p.url.indexOf('?') >= 0 ? '&' : '?';
      window.open(p.url + (withNeg ? sep + 'btg_neg=1' : ''), '_blank');
      return true;
    }
    var name = p.product_name || p.title || p.name || '';
    if (name) { window.open('/search?q=' + encodeURIComponent(name), '_blank'); return true; }
    return false;
  }

  // ── Exclude current product + items already in cart from a recommendation list ─
  function _btgvFilterShown(products, cb) {
    var currentHandle = '';
    var m = window.location.pathname.match(/\/products\/([^/?#]+)/);
    if (m) currentHandle = m[1];

    fetch('/cart.js', { headers: { 'Accept': 'application/json' }})
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .catch(function () { return { items: [] }; })
      .then(function (cart) {
        var cartHandles = {}; var cartIds = {};
        (cart.items || []).forEach(function (it) {
          if (it.handle) cartHandles[it.handle] = 1;
          if (it.product_id) cartIds[String(it.product_id)] = 1;
        });
        var filtered = products.filter(function (p) {
          var h = (p.handle || _resolveProductHandle(p) || '').toLowerCase();
          var id = String(p.id || p.shopify_product_id || '');
          if (currentHandle && h && h === currentHandle.toLowerCase()) return false;
          if (h && cartHandles[h]) return false;
          if (id && cartIds[id]) return false;
          return true;
        });
        cb(filtered);
      });
  }

  // ── Unified horizontal product card renderer ─────────────────────────────────
  function _cncgRenderProducts(msgs, products, opts) {
    opts = opts || {};
    if (!products || !products.length) return;
    var wrap = document.createElement('div'); wrap.className = '_btgv_cncg_pcards';
    products.slice(0, 8).forEach(function (p) {
      var card = document.createElement('div'); card.className = '_btgv_cncg_pcard';

      var img = document.createElement('img'); img.className = '_btgv_cncg_pcard_img';
      img.src = p.image_url || p.image || ''; img.alt = '';
      img.onerror = function () { this.style.background = '#1a1a2e'; this.style.display = 'block'; this.removeAttribute('src'); };
      card.appendChild(img);

      var body = document.createElement('div'); body.className = '_btgv_cncg_pcard_body';
      var nm = document.createElement('div'); nm.className = '_btgv_cncg_pcard_nm';
      nm.textContent = p.product_name || p.title || p.name || '';
      var pr = document.createElement('div'); pr.className = '_btgv_cncg_pcard_pr';
      var price = parseFloat(p.price || 0), was = parseFloat(p.compare_at_price || 0);
      var priceEl = document.createElement('span'); priceEl.className = '_btgv_cncg_pcard_price';
      priceEl.textContent = '$' + price.toFixed(2); pr.appendChild(priceEl);
      if (was > price) {
        var wasEl = document.createElement('span'); wasEl.className = '_btgv_cncg_pcard_was';
        wasEl.textContent = '$' + was.toFixed(2); pr.appendChild(wasEl);
        var badge = document.createElement('span'); badge.className = '_btgv_cncg_pcard_badge';
        badge.textContent = Math.round((1 - price / was) * 100) + '% off'; pr.appendChild(badge);
      }

      // Card tap → always open in new tab (handle → URL → search), never local modal
      (function (prod) {
        card.onclick = function (e) {
          if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
          _navProductInNewTab(prod, true);
        };
      })(p);

      var btns = document.createElement('div'); btns.className = '_btgv_cncg_pcard_btns';
      var variantId = p.shopify_variant_id || p.variant_id;

      // Row 1: [Add to cart] + [Buy Now] side by side
      var row = document.createElement('div'); row.className = '_btgv_cncg_pcard_row';
      var cartBtn = document.createElement('button'); cartBtn.className = '_btgv_cncg_pcard_cart'; cartBtn.textContent = '🛒 Add to cart';
      var buyBtn = document.createElement('button'); buyBtn.className = '_btgv_cncg_pcard_buy'; buyBtn.textContent = '⚡ Buy Now';
      (function (vid, cBtn, bBtn, parentCard) {
        cBtn.onclick = function (e) {
          e.stopPropagation();
          cBtn.textContent = 'Adding…'; cBtn.disabled = true;
          addToCart(vid, function (ok) {
            if (ok) {
              fireConfetti();
              cBtn.textContent = '✓ Added!'; cBtn.disabled = false;
              cBtn.style.background = '#22c55e';
              if (msgs) msgs.scrollTop = msgs.scrollHeight;
            } else {
              cBtn.textContent = '🛒 Add to cart'; cBtn.disabled = false;
            }
          });
        };
        bBtn.onclick = function (e) {
          e.stopPropagation();
          bBtn.textContent = 'Adding…'; bBtn.disabled = true;
          addToCart(vid, function (ok) {
            if (ok) { closeConcierge(); window.location.href = '/checkout'; }
            else { bBtn.textContent = '⚡ Buy Now'; bBtn.disabled = false; }
          });
        };
      })(variantId, cartBtn, buyBtn, card);
      row.appendChild(cartBtn); row.appendChild(buyBtn);
      btns.appendChild(row);

      // Row 2: Make an offer (full width) → always new tab
      var negBtn = document.createElement('button'); negBtn.className = '_btgv_cncg_pcard_neg'; negBtn.textContent = '🤝 Make an offer';
      (function (prod) {
        negBtn.onclick = function (e) {
          e.stopPropagation();
          _navProductInNewTab(prod, true);
        };
      })(p);
      btns.appendChild(negBtn);

      body.appendChild(nm); body.appendChild(pr); body.appendChild(btns);
      card.appendChild(body);
      wrap.appendChild(card);
    });

    var wrapW = document.createElement('div'); wrapW.className = '_btgv_cncg_pcardsw';
    wrapW.appendChild(wrap);
    msgs.appendChild(wrapW);

    // Track which products are in context so downstream chips act on them directly
    if (_cncgEl) _cncgEl._lastShownProducts = products.slice(0, 8);

    // Post-card chips: "Make an offer" is already on every card, so don't repeat it.
    // Show only: Add [first product] to cart + Shop the videos (max 2 chips).
    var firstP = products[0];
    if (firstP) {
      var firstVid = firstP.shopify_variant_id || firstP.variant_id;
      var ws = _chipWatchShop();
      _cncgAddChips(msgs, _buildChips(msgs, [
        { label: '🛒 Add to cart', fn: function (m) {
          if (!firstVid) return;
          addToCart(firstVid, function (ok) {
            if (ok) {
              fireConfetti();
              _cncgAddBot(m, '✓ Added to cart! Ready to checkout or keep browsing?');
              _cncgAddChips(m, _buildChips(m, [
                { label: '⚡ Checkout', fn: function () { window.location.href = '/checkout'; }},
                { label: _chipWatchShop().label, fn: _chipWatchShop().fn },
              ]));
            }
          });
        }},
        { label: ws.label, fn: ws.fn },
      ]));
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── Promotions — surfaces active sale collections + featured deals ─────────
  function _cncgPromotions(msgs) {
    var typing = _cncgTyping(msgs, ['Looking up active promos…', 'Finding deals…']);
    _fetchCollectionDealsCatalog(function (catalog) {
      typing.remove();
      var sale = (catalog.feature_collections || []).filter(function (c) {
        return /sale|clearance|deal|markdown|outlet|promo/i.test((c.handle || '') + ' ' + (c.title || ''));
      });
      var withDiscount = (catalog.products || []).filter(function (p) {
        var price = parseFloat(p.price || 0); var was = parseFloat(p.compare_at_price || 0);
        return was > price && price > 0;
      });
      if (!sale.length && !withDiscount.length) {
        _cncgAddBot(msgs, "No active sale running right now — but you can still ask me to negotiate any item. 🤝");
        _cncgBackChip(msgs);
        return;
      }
      var lines = [];
      if (sale.length) lines.push('🏷️ Active sale collections: <b>' + sale.slice(0, 3).map(function (c) { return c.title; }).join(', ') + '</b>');
      if (withDiscount.length) {
        var top = withDiscount.sort(function (a, b) {
          return ((b.compare_at_price - b.price) / b.compare_at_price) - ((a.compare_at_price - a.price) / a.compare_at_price);
        })[0];
        var pct = Math.round((1 - top.price / top.compare_at_price) * 100);
        lines.push('💸 Biggest markdown: <b>' + top.title + '</b> at ' + pct + '% off');
      }
      lines.push('— or just tell me what you\'re after and I\'ll negotiate it for you. 🤝');
      _cncgAddBot(msgs, lines.join('<br>'), true);
      _cncgBackChip(msgs);
    });
  }

  // ── Recent conversations — pulls thread history from the server ─────────────
  function _cncgRecentConvs(msgs) {
    var typing = _cncgTyping(msgs, ['Pulling your history…']);
    var sessionId = _getOrInitSessionId();
    fetch(API_BASE + '/api/concierge/threads?k=' + API_KEY + '&session_id=' + encodeURIComponent(sessionId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        typing.remove();
        var threads = (d && d.threads) || [];
        if (!threads.length) {
          _cncgAddBot(msgs, "No prior conversations on file — but we can start one right now! ✨");
          _cncgBackChip(msgs);
          return;
        }
        _cncgAddBot(msgs, '💬 Your recent conversations:');
        threads.slice(0, 5).forEach(function (t) {
          var preview = (t.last_message || '').slice(0, 80);
          var when = t.last_at ? new Date(t.last_at).toLocaleDateString() : '';
          var line = document.createElement('div');
          line.style.cssText = 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);padding:8px 12px;border-radius:10px;font-size:12px;color:rgba(255,255,255,.78);margin:4px 0;';
          line.innerHTML = '<div style="opacity:.5;font-size:10px;margin-bottom:2px;">' + when + '</div>' + preview;
          msgs.appendChild(line);
        });
        _cncgBackChip(msgs);
      })
      .catch(function () {
        typing.remove();
        _cncgAddBot(msgs, "Couldn't load history right now.");
        _cncgBackChip(msgs);
      });
  }

  // ── Track order ──────────────────────────────────────────────────────────────
  function _cncgTrackOrder(msgs) {
    _cncgAddBot(msgs, "Enter your order number and email to check your order status 📦");
    var card = document.createElement('div'); card.className = '_btgv_cncg_order_track';
    var orderInp = document.createElement('input'); orderInp.className = '_btgv_cncg_order_inp';
    orderInp.placeholder = 'Order number (e.g. #1001)'; orderInp.type = 'text';
    var emailInp = document.createElement('input'); emailInp.className = '_btgv_cncg_order_inp';
    emailInp.placeholder = 'Email address'; emailInp.type = 'email';
    var submitBtn = document.createElement('button'); submitBtn.className = '_btgv_cncg_order_submit';
    submitBtn.textContent = 'Track order';
    submitBtn.onclick = function (e) {
      e.stopPropagation();
      var num = orderInp.value.trim().replace(/^#/, '');
      var email = emailInp.value.trim();
      if (!num || !email) { orderInp.style.borderColor = '#ff4d6d'; return; }
      submitBtn.textContent = 'Looking up…'; submitBtn.disabled = true;
      fetch(API_BASE + '/api/widget/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: API_KEY, order_number: num, email: email })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          card.remove();
          if (d.error) { _cncgAddBot(msgs, "I couldn't find that order. Check your order number and email and try again."); _cncgBackChip(msgs); return; }
          var o = d.order;
          var statusColors = { fulfilled: '#22c55e', unfulfilled: '#f59e0b', partially_fulfilled: '#f59e0b', cancelled: '#ef4444', refunded: '#6366f1' };
          var statusEl = document.createElement('div'); statusEl.className = '_btgv_cncg_order';
          var hd = document.createElement('div'); hd.className = '_btgv_cncg_order_hd';
          var nm = document.createElement('div'); nm.className = '_btgv_cncg_order_nm'; nm.textContent = '#' + o.order_number;
          var st = document.createElement('div'); st.className = '_btgv_cncg_order_status';
          st.textContent = o.fulfillment_status || 'Processing';
          st.style.background = (statusColors[o.fulfillment_status] || '#6366f1') + '22';
          st.style.color = statusColors[o.fulfillment_status] || '#6366f1';
          hd.appendChild(nm); hd.appendChild(st);
          var row1 = document.createElement('div'); row1.className = '_btgv_cncg_order_row';
          row1.innerHTML = '<span>Total</span><span>$' + parseFloat(o.total_price || 0).toFixed(2) + '</span>';
          var row2 = document.createElement('div'); row2.className = '_btgv_cncg_order_row';
          row2.innerHTML = '<span>Items</span><span>' + (o.line_items || []).length + '</span>';
          statusEl.appendChild(hd); statusEl.appendChild(row1); statusEl.appendChild(row2);
          if (o.tracking_url) {
            var trackLink = document.createElement('a'); trackLink.href = o.tracking_url; trackLink.target = '_blank';
            trackLink.style.cssText = 'color:#6366f1;font-size:11px;font-weight:600;text-decoration:none;margin-top:2px';
            trackLink.textContent = '🚚 Track shipment →';
            statusEl.appendChild(trackLink);
          }
          msgs.appendChild(statusEl);
          _cncgBackChip(msgs);
          msgs.scrollTop = msgs.scrollHeight;
        })
        .catch(function () {
          card.remove();
          _cncgAddBot(msgs, "Couldn't reach the server. Try again in a moment.");
          _cncgBackChip(msgs);
        });
    };
    card.appendChild(orderInp); card.appendChild(emailInp); card.appendChild(submitBtn);
    msgs.appendChild(card);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── Chip helpers — varied language so chips never feel like a phone menu ─────

  // Watch & Shop chip — always leads; label rotates so it feels fresh on re-entry
  var _wsLabels = ['🎬 Watch & Shop', '📱 Shop the videos', '🎬 See it in action', '🎬 Watch & find your pick'];
  var _wsIdx = 0;
  function _chipWatchShop() {
    var label = _wsLabels[_wsIdx % _wsLabels.length]; _wsIdx++;
    return { label: label, fn: function (msgs) { _cncgWatchShop(msgs); } };
  }

  // Deal chip — always second; rotates phrasing
  var _dealLabels = ['🤝 Get me a deal', '💸 I want a better price', '🤝 Make an offer', '💰 Negotiate a price', '🤝 Can I pay less?'];
  var _dealIdx = 0;
  function _chipDeal() {
    var label = _dealLabels[_dealIdx % _dealLabels.length]; _dealIdx++;
    return { label: label, fn: function (msgs) { _cncgDeals(msgs); } };
  }

  // Find chip — conversational third option; rotates
  var _findLabels = ['🔍 Help me find something', '🔍 Show me more options', '🔍 I\'m looking for something specific', '🔍 Browse the catalog'];
  var _findIdx = 0;
  function _chipFind() {
    var label = _findLabels[_findIdx % _findLabels.length]; _findIdx++;
    return { label: label, fn: function (msgs) { _cncgFind(msgs); } };
  }

  // Build chips with msgs injected into fns (chips need msgs at call time)
  function _buildChips(msgs, defs) {
    return defs.map(function (d) {
      return { label: d.label, fn: function () { d.fn(msgs); } };
    });
  }

  // ── PDP product fetch — pulls the live Shopify product JSON for the
  // current /products/{handle} page so chips can answer "fabric / sizes /
  // details" without round-tripping to the LLM. Cached per widget session.
  function _cncgGetPDPHandle() {
    var m = window.location.pathname.match(/\/products\/([^/?#]+)/);
    return m ? m[1] : null;
  }
  function _cncgFetchPDPProduct(cb) {
    if (_cncgEl && _cncgEl._pdpProduct) { cb(_cncgEl._pdpProduct); return; }
    var handle = _cncgGetPDPHandle();
    if (!handle) { cb(null); return; }
    fetch('/products/' + handle + '.js')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) {
        if (_cncgEl) _cncgEl._pdpProduct = p;
        cb(p);
      })
      .catch(function () { cb(null); });
  }
  // Strip HTML and trim a description down to one or two readable sentences.
  function _cncgCleanDesc(html) {
    if (!html) return '';
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html);
    var txt = (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
    if (txt.length <= 280) return txt;
    var cut = txt.slice(0, 280);
    var dot = cut.lastIndexOf('.');
    return (dot > 100 ? cut.slice(0, dot + 1) : cut) + (txt.length > 280 ? '…' : '');
  }
  function _cncgPDPInStockSizes(p) {
    if (!p || !Array.isArray(p.variants)) return [];
    var sizes = [];
    p.variants.forEach(function (v) {
      if (v && v.available && v.public_title) sizes.push(v.public_title);
      else if (v && v.available && v.title && v.title !== 'Default Title') sizes.push(v.title);
    });
    return sizes;
  }

  // ── Opening chips — W&S + Deal always first, third varies by context ─────────
  function _cncgMainMenu(msgs) {
    // Returning to main menu means we've left product context
    if (_cncgEl) _cncgEl._lastShownProducts = null;
    var ctx = _getPageContext();
    var ws = _chipWatchShop(), deal = _chipDeal(), find = _chipFind();

    if (ctx.type === 'product' && ctx.title) {
      // REP-style product-aware chips. Pre-fetches the product so chip
      // handlers can answer fabric/sizes/details without LLM round-trips.
      _cncgFetchPDPProduct(function () {});
      _cncgAddChips(msgs, _buildChips(msgs, [
        { label: deal.label, fn: deal.fn },
        { label: '📏 In stock sizes', fn: function (m) { _cncgPDPSizes(m); }},
        { label: '🧵 Fabric', fn: function (m) { _cncgPDPFabric(m); }},
        { label: '📐 Details & silhouette', fn: function (m) { _cncgPDPDetails(m); }},
        { label: '🛍️ Browse for more', fn: function (m) {
          _cncgSend('Show me something similar to ' + ctx.title, m, _cncgEl._inp, _cncgEl._sendBtn);
        }},
      ]));
    } else if (ctx.type === 'cart') {
      _cncgAddChips(msgs, _buildChips(msgs, [
        { label: ws.label, fn: ws.fn },
        { label: '🤝 Get a deal before checkout', fn: function (m) { _cncgDeals(m); }},
        { label: '⚡ Go to checkout', fn: function () { closeConcierge(); window.location.href = '/checkout'; }},
      ]));
    } else {
      _cncgAddChips(msgs, _buildChips(msgs, [
        { label: ws.label, fn: ws.fn },
        { label: deal.label, fn: deal.fn },
        { label: find.label, fn: find.fn },
      ]));
    }
  }

  // ── Product-aware chip handlers (Fabric / Details / In stock sizes) ─────────
  function _cncgPDPSizes(msgs) {
    _cncgFetchPDPProduct(function (p) {
      if (!p) { _cncgAddBot(msgs, "Couldn't pull this product's variants — try the size dropdown on the page."); _cncgPDPBackChips(msgs); return; }
      var sizes = _cncgPDPInStockSizes(p);
      if (!sizes.length) {
        _cncgAddBot(msgs, "Looks like this is sold out, darling — but I can find something similar! 💫");
      } else {
        _cncgAddBot(msgs, '📏 In stock right now: <b>' + sizes.join(' · ') + '</b>', true);
      }
      _cncgPDPBackChips(msgs);
    });
  }
  function _cncgPDPFabric(msgs) {
    _cncgFetchPDPProduct(function (p) {
      if (!p) { _cncgAddBot(msgs, "Couldn't pull the product info — try the description on the page."); _cncgPDPBackChips(msgs); return; }
      var desc = _cncgCleanDesc(p.description || p.body_html || '');
      // Pull fabric/material sentence if we can find one
      var sentence = null;
      if (desc) {
        var rx = /([^.!?]*\b(fabric|material|cotton|silk|satin|chiffon|tulle|velvet|lace|polyester|nylon|spandex|wool|linen|denim|leather|sequin|beaded|knit|jersey|crepe)[^.!?]*[.!?])/i;
        var m = desc.match(rx);
        if (m) sentence = m[1].trim();
      }
      // Tag-based fallback
      if (!sentence && Array.isArray(p.tags) && p.tags.length) {
        var fabricTags = p.tags.filter(function (t) { return /silk|satin|cotton|lace|velvet|linen|denim|wool|leather|sequin|beaded/i.test(t); });
        if (fabricTags.length) sentence = 'Fabric tags on this piece: ' + fabricTags.join(', ') + '.';
      }
      _cncgAddBot(msgs, sentence || "🧵 The product page has the full fabric breakdown — want me to pull the description?");
      _cncgPDPBackChips(msgs);
    });
  }
  function _cncgPDPDetails(msgs) {
    _cncgFetchPDPProduct(function (p) {
      if (!p) { _cncgAddBot(msgs, "Couldn't pull the details — try the description on the page."); _cncgPDPBackChips(msgs); return; }
      var desc = _cncgCleanDesc(p.description || p.body_html || '');
      if (!desc) { _cncgAddBot(msgs, "No detailed description on this one — but I can pull up similar styles. 💫"); _cncgPDPBackChips(msgs); return; }
      _cncgAddBot(msgs, '📐 ' + desc);
      _cncgPDPBackChips(msgs);
    });
  }
  function _cncgPDPBackChips(msgs) {
    var deal = _chipDeal();
    _cncgAddChips(msgs, _buildChips(msgs, [
      { label: deal.label, fn: deal.fn },
      { label: '🛍️ Browse for more', fn: function (m) { _cncgMainMenu(m); }},
    ]));
  }

  // ── Inline variant picker — REP-style carousel of variant tiles inside
  // the chat. Customer never leaves the conversation to pick size/color.
  // Filters by hints from the user's message ("add size 6 in red"); if no
  // matches, falls back to all available variants.
  function _cncgPDPVariantPicker(msgs, sizeHint, colorHint) {
    _cncgFetchPDPProduct(function (p) {
      if (!p || !Array.isArray(p.variants) || !p.variants.length) {
        _cncgAddBot(msgs, "Hmm, couldn't pull this product's variants — try the page form instead.");
        _cncgPDPBackChips(msgs);
        return;
      }
      var available = p.variants.filter(function (v) { return v.available; });
      if (!available.length) {
        _cncgAddBot(msgs, "Looks like this is sold out, darling — but I can find something similar! 💫");
        _cncgPDPBackChips(msgs);
        return;
      }
      // Filter by hints (case-insensitive substring on variant title + options)
      function variantMatches(v, hint) {
        if (!hint) return true;
        var hay = ((v.title || '') + ' ' + (v.public_title || '') + ' ' + (v.option1 || '') + ' ' + (v.option2 || '') + ' ' + (v.option3 || '')).toLowerCase();
        return hay.indexOf(String(hint).toLowerCase()) !== -1;
      }
      var filtered = available.filter(function (v) { return variantMatches(v, sizeHint) && variantMatches(v, colorHint); });
      var pool = filtered.length ? filtered : available;

      var prompt = (filtered.length && (sizeHint || colorHint))
        ? 'Got it — pick the option you want:'
        : 'Now choose your size:';
      _cncgAddBot(msgs, prompt);

      var carousel = document.createElement('div');
      carousel.className = '_btgv_cncg_vpicker';
      pool.slice(0, 12).forEach(function (v) {
        var tile = document.createElement('button');
        tile.className = '_btgv_cncg_vpickeritem';
        // Variant image: prefer featured_image on variant, fallback to product first image
        var imgSrc = (v.featured_image && v.featured_image.src) || (p.featured_image) || (p.images && p.images[0]) || null;
        var imgHtml = imgSrc ? '<img src="' + imgSrc + '" alt="">' : '<div style="background:rgba(255,255,255,.08);width:100%;height:100%;"></div>';
        var title = v.public_title || v.title || 'Default';
        // /products/{handle}.js returns price in cents (integer)
        var priceCents = parseFloat(v.price);
        var price = (isFinite(priceCents) && priceCents > 0) ? (priceCents / 100).toFixed(0) : '—';
        tile.innerHTML =
          '<div class="_btgv_cncg_vpicker_img">' + imgHtml + '</div>' +
          '<div class="_btgv_cncg_vpicker_t">' + title + '</div>' +
          '<div class="_btgv_cncg_vpicker_p">$' + price + '</div>';
        tile.onclick = function (e) {
          e.stopPropagation();
          carousel.remove();
          _cncgAddUser(msgs, title);
          _cncgAddBot(msgs, 'Adding to your cart…');
          addToCart(v.id, function (ok) {
            if (ok) {
              _btgvAttributeCart();
              _btgvInjectCartBadge();
              fireConfetti();
              _cncgAddBot(msgs, "Certainly — I've added 1 × " + p.title + " - " + title + " to your cart.<br><br>Is there anything else I can assist you with?", true);
              _cncgAddChips(msgs, _buildChips(msgs, [
                { label: '⚡ Checkout', fn: function () { window.location.href = '/checkout'; }},
                { label: '🛍️ Browse for more', fn: function (m) { _cncgMainMenu(m); }},
              ]));
            } else {
              _cncgAddBot(msgs, "Hmm, couldn't add it. Try the size dropdown on the page.");
              _cncgPDPBackChips(msgs);
            }
          });
        };
        carousel.appendChild(tile);
      });
      msgs.appendChild(carousel);
      msgs.scrollTop = msgs.scrollHeight;
    });
  }

  // ── After any interaction — weave W&S and deal back in with fresh language ───
  function _cncgBackChip(msgs) {
    if (_cncgEl) _cncgEl._lastShownProducts = null;
    var ws = _chipWatchShop(), deal = _chipDeal();
    _cncgAddChips(msgs, _buildChips(msgs, [
      { label: ws.label, fn: ws.fn },
      { label: deal.label, fn: deal.fn },
    ]));
  }

  // ── Chip renderer — removes row after tap, adds user bubble ─────────────────
  function _cncgAddChips(msgs, chips) {
    var row = document.createElement('div'); row.className = '_btgv_cncg_chips';
    chips.forEach(function (c) {
      var chip = document.createElement('button'); chip.className = '_btgv_cncg_chip'; chip.textContent = c.label;
      chip.onclick = function (e) {
        e.stopPropagation(); row.remove();
        _cncgAddUser(msgs, c.label); c.fn();
      };
      row.appendChild(chip);
    });
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── Watch & Shop — horizontal video carousel ────────────────────────────────
  function _cncgWatchShop(msgs) {
    var feedItems = _cncgEl._feedItems || [];
    // Include both real videos AND photo posts (s3_url null but
    // thumbnail_url present). Photo posts render as static frames and
    // are still shoppable. Previously the filter dropped photo posts,
    // which left IG-photo-only merchants with empty Watch & Shop.
    var videos = feedItems.filter(function (v) {
      return v._type !== 'product' && (v.s3_url || v.thumbnail_url);
    }).slice(0, 10);
    var typing = _cncgTyping(msgs);
    setTimeout(function () {
      typing.remove();
      if (!videos.length) {
        _cncgAddBot(msgs, "No videos uploaded yet. Check back soon! 🎬");
        _cncgBackChip(msgs); return;
      }
      var wsGreets = ["I picked these out just for you — take a look 🔥", "Here's what's trending right now, and honestly, the quality is stunning 😍", "These are my favorites this week — I think you'll love them 🎬"];
      _cncgAddBot(msgs, wsGreets[Math.floor(Math.random() * wsGreets.length)]);
      var carousel = document.createElement('div'); carousel.className = '_btgv_cncg_vcarousel';
      videos.forEach(function (v) {
        var vIdx = feedItems.indexOf(v);
        var products = v.video_product_tags || [];
        var firstProduct = products[0] || null;

        var tile = document.createElement('div'); tile.className = '_btgv_cncg_vtile';

        // ── Media area ──
        var media = document.createElement('div'); media.className = '_btgv_cncg_vtile_media';

        if (v.thumbnail_url) {
          var thumb = document.createElement('img'); thumb.src = v.thumbnail_url; thumb.alt = '';
          thumb.referrerPolicy = 'no-referrer';
          media.appendChild(thumb);
        }
        // Only attach a <video> element if we actually have a video URL.
        // Photo posts (s3_url null) just show the thumbnail.
        if (v.s3_url) {
          var vid = document.createElement('video');
          vid.src = v.s3_url; vid.muted = true; vid.loop = true; vid.playsInline = true;
          vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .2s';
          media.appendChild(vid);
          vid.play().catch(function () {});
          setTimeout(function () { vid.style.opacity = '1'; }, 100);
        }

        var ov = document.createElement('div'); ov.className = '_btgv_cncg_vtile_ov'; media.appendChild(ov);

        // Views — top left
        var viewsEl = document.createElement('div'); viewsEl.className = '_btgv_cncg_vtile_views';
        viewsEl.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>' + fmtCount(v.views_count || 0) + '</span>';
        media.appendChild(viewsEl);

        // Title overlay — skip filename-style titles (mvi_2462, IMG_1234, etc.)
        var cleanTitle = (v.title || '').trim();
        if (/^(mvi|img|vid|dsc|mov|mp4|vlc)[_\-]?\d+/i.test(cleanTitle) ||
            (/^\S+\.\w{2,4}$/.test(cleanTitle)) ||
            (cleanTitle.length > 0 && cleanTitle.indexOf(' ') === -1 && /^\d/.test(cleanTitle))) {
          cleanTitle = '';
        }
        if (cleanTitle) {
          var foot = document.createElement('div'); foot.className = '_btgv_cncg_vtile_foot';
          var tl = document.createElement('div'); tl.className = '_btgv_cncg_vtile_title'; tl.textContent = cleanTitle;
          foot.appendChild(tl); media.appendChild(foot);
        }

        // Right rail — likes, comments, share
        var rail = document.createElement('div'); rail.className = '_btgv_cncg_vtile_rail';
        (function (vv, vvIdx) {
          var likeAct = document.createElement('div'); likeAct.className = '_btgv_cncg_vtile_action';
          var likeIc = document.createElement('div'); likeIc.className = '_btgv_cncg_vtile_action_ic'; likeIc.textContent = '❤️';
          var likeLbl = document.createElement('div'); likeLbl.className = '_btgv_cncg_vtile_action_lbl'; likeLbl.textContent = fmtCount(vv.likes_count || 0);
          likeAct.appendChild(likeIc); likeAct.appendChild(likeLbl); rail.appendChild(likeAct);

          var cmtAct = document.createElement('div'); cmtAct.className = '_btgv_cncg_vtile_action';
          var cmtIc = document.createElement('div'); cmtIc.className = '_btgv_cncg_vtile_action_ic'; cmtIc.textContent = '💬';
          var cmtLbl = document.createElement('div'); cmtLbl.className = '_btgv_cncg_vtile_action_lbl'; cmtLbl.textContent = fmtCount(vv.comments_count || 0);
          cmtAct.onclick = function (e) { e.stopPropagation(); closeConcierge(); openFeed(vvIdx >= 0 ? vvIdx : 0, feedItems); };
          cmtAct.appendChild(cmtIc); cmtAct.appendChild(cmtLbl); rail.appendChild(cmtAct);

          var shareAct = document.createElement('div'); shareAct.className = '_btgv_cncg_vtile_action';
          var shareIc = document.createElement('div'); shareIc.className = '_btgv_cncg_vtile_action_ic'; shareIc.textContent = '↗️';
          var shareLbl = document.createElement('div'); shareLbl.className = '_btgv_cncg_vtile_action_lbl'; shareLbl.textContent = 'Share';
          shareAct.onclick = function (e) {
            e.stopPropagation();
            var url = window.location.href;
            if (navigator.share) { navigator.share({ title: vv.title || 'Check this out', url: url }); }
            else { navigator.clipboard && navigator.clipboard.writeText(url); }
          };
          shareAct.appendChild(shareIc); shareAct.appendChild(shareLbl); rail.appendChild(shareAct);
        })(v, vIdx);
        media.appendChild(rail);

        tile.appendChild(media);
        // Tile click → open product in new tab if there's a product, else open feed
        tile.onclick = function () {
          var fp2 = firstProduct;
          if (fp2 && _navProductInNewTab(fp2, false)) return;
          closeConcierge(); openFeed(vIdx >= 0 ? vIdx : 0, feedItems);
        };

        // ── CTA panel (white strip below video) ──
        if (firstProduct) {
          var panel = document.createElement('div'); panel.className = '_btgv_cncg_vtile_panel';
          var prow = document.createElement('div'); prow.className = '_btgv_cncg_vtile_prow';
          var cartBtn = document.createElement('button'); cartBtn.className = '_btgv_cncg_vtile_pcart'; cartBtn.textContent = '🛒 Add to cart';
          var buyBtn = document.createElement('button'); buyBtn.className = '_btgv_cncg_vtile_pbuy'; buyBtn.textContent = '⚡ Buy Now';
          var negBtn = document.createElement('button'); negBtn.className = '_btgv_cncg_vtile_pneg'; negBtn.textContent = '🤝 Make an offer';
          var variantId = firstProduct.shopify_variant_id || firstProduct.variant_id;
          (function (vid2, cBtn, bBtn, nBtn, fp) {
            cBtn.onclick = function (e) {
              e.stopPropagation();
              cBtn.textContent = 'Adding…'; cBtn.disabled = true;
              addToCart(vid2, function (ok) {
                if (ok) { fireConfetti(); cBtn.textContent = '✓ Added!'; cBtn.style.background = '#22c55e'; cBtn.disabled = false; }
                else { cBtn.textContent = '🛒 Add to cart'; cBtn.disabled = false; }
              });
            };
            bBtn.onclick = function (e) {
              e.stopPropagation();
              bBtn.textContent = 'Going…'; bBtn.disabled = true;
              addToCart(vid2, function (ok) {
                if (ok) { closeConcierge(); window.location.href = '/checkout'; }
                else { bBtn.textContent = '⚡ Buy Now'; bBtn.disabled = false; }
              });
            };
            nBtn.onclick = function (e) {
              e.stopPropagation();
              if (fp) _navProductInNewTab(fp, true);
            };
          })(variantId, cartBtn, buyBtn, negBtn, firstProduct);
          prow.appendChild(cartBtn); prow.appendChild(buyBtn);
          panel.appendChild(prow); panel.appendChild(negBtn);
          tile.appendChild(panel);
        }

        carousel.appendChild(tile);
      });
      var vwrap = document.createElement('div'); vwrap.className = '_btgv_cncg_vcarouselw';
      vwrap.appendChild(carousel);
      var vstep = 230; // 220px tile + 10px gap
      var vprev = document.createElement('button'); vprev.className = '_btgv_cncg_pscrl _btgv_cncg_pscrl_l'; vprev.innerHTML = '&#8249;'; vprev.style.display = 'none';
      vprev.onclick = function (e) { e.stopPropagation(); carousel.scrollBy({ left: -vstep, behavior: 'smooth' }); };
      var vnext = document.createElement('button'); vnext.className = '_btgv_cncg_pscrl _btgv_cncg_pscrl_r'; vnext.innerHTML = '&#8250;';
      vnext.onclick = function (e) { e.stopPropagation(); carousel.scrollBy({ left: vstep, behavior: 'smooth' }); };
      carousel.addEventListener('scroll', function () {
        vprev.style.display = carousel.scrollLeft > 10 ? 'flex' : 'none';
        vnext.style.display = (carousel.scrollLeft + carousel.clientWidth < carousel.scrollWidth - 10) ? 'flex' : 'none';
      });
      if (videos.length <= 1) vnext.style.display = 'none';
      vwrap.appendChild(vprev); vwrap.appendChild(vnext);
      msgs.appendChild(vwrap);
      var deal = _chipDeal(), find = _chipFind();
      _cncgAddChips(msgs, _buildChips(msgs, [
        { label: deal.label, fn: deal.fn },
        { label: find.label, fn: find.fn },
      ]));
      msgs.scrollTop = msgs.scrollHeight;
    }, 550);
  }

  // ── Collection scoring — feature collections surface first ──────────────────
  // Patterns ranked by recency/marketability. Higher score = surfaced first
  // as a suggestion tile. Anything matching → "feature" collection.
  // The score doubles as the tile sort key.
  var _COLLECTION_RULES = [
    { score: 100, rx: /\b(new|new[\s-]*arrival|just[\s-]*in|fresh)\b/i,                   label: '✨ New' },
    { score:  95, rx: /\b(best[\s-]*seller|bestseller|trending|popular|hot)\b/i,         label: '🔥 Best Sellers' },
    { score:  90, rx: /\b(featured|spotlight|staff[\s-]*pick|editor)\b/i,                 label: '⭐ Featured' },
    { score:  85, rx: /\b(sale|clearance|deal|markdown|outlet)\b/i,                       label: '💰 On Sale' },
    { score:  80, rx: /\b(summer|spring|fall|autumn|winter|holiday|seasonal)\b/i,         label: '🌞 Seasonal' },
    { score:  60, rx: /\b(limited|exclusive)\b/i,                                          label: '✨ Limited' },
  ];

  // Score a collection by handle + title. Returns { score, label } or null.
  function _scoreCollection(col) {
    var hay = ((col.handle || '') + ' ' + (col.title || '')).toLowerCase();
    for (var i = 0; i < _COLLECTION_RULES.length; i++) {
      if (_COLLECTION_RULES[i].rx.test(hay)) return { score: _COLLECTION_RULES[i].score, label: _COLLECTION_RULES[i].label };
    }
    return null;
  }

  function _normalizeColProduct(p) {
    var v = p.variants && p.variants[0];
    if (!v) return null;
    // Shopify /collections/{h}/products.json sets v.available — false means out of stock
    var available = v.available !== false;
    return {
      shopify_product_id: String(p.id),
      product_name: p.title,
      handle: p.handle,
      image_url: (p.images && p.images[0] && p.images[0].src) || '',
      price: v.price,
      compare_at_price: v.compare_at_price || '0',
      variant_id: v.id,
      created_at: p.created_at || p.published_at || null,
      available: available,
      tags: p.tags || '',
    };
  }

  // Pull /products.json + /collections.json + each feature collection's products,
  // de-dupe, score, and return the merged list with provenance attached.
  function _fetchCollectionDealsCatalog(cb) {
    if (_cncgEl && _cncgEl._cncgCatalog) { cb(_cncgEl._cncgCatalog); return; }

    Promise.all([
      fetch('/collections.json?limit=50').then(function (r) { return r.ok ? r.json() : { collections: [] }; }).catch(function () { return { collections: [] }; }),
      fetch('/products.json?limit=250').then(function (r) { return r.ok ? r.json() : { products: [] }; }).catch(function () { return { products: [] }; }),
    ]).then(function (results) {
      var collectionsRaw = (results[0].collections || []).filter(function (c) { return c.handle !== 'all'; });
      var allProducts = (results[1].products || []).map(_normalizeColProduct).filter(Boolean);

      // Score collections
      var featureCols = [];
      collectionsRaw.forEach(function (col) {
        var hit = _scoreCollection(col);
        if (hit) featureCols.push(Object.assign({}, col, { _score: hit.score, _tile_label: hit.label }));
      });
      featureCols.sort(function (a, b) { return b._score - a._score; });

      // For each feature collection, pull its products in parallel (cap 8)
      var topFeatureCols = featureCols.slice(0, 8);
      var colFetches = topFeatureCols.map(function (col) {
        return fetch('/collections/' + col.handle + '/products.json?limit=12')
          .then(function (r) { return r.ok ? r.json() : { products: [] }; })
          .then(function (d) {
            return {
              col: col,
              products: (d.products || []).map(_normalizeColProduct).filter(Boolean),
            };
          })
          .catch(function () { return { col: col, products: [] }; });
      });

      Promise.all(colFetches).then(function (cols) {
        // Build merged catalog with provenance:
        //   - first pass: feature-collection products carry collection_score & collection_label
        //   - second pass: remaining /products.json items fill the tail
        var byId = {};
        var ordered = [];

        cols.forEach(function (entry) {
          (entry.products || []).forEach(function (p) {
            if (byId[p.shopify_product_id]) return;
            byId[p.shopify_product_id] = true;
            ordered.push(Object.assign({}, p, {
              collection_handle: entry.col.handle,
              collection_title: entry.col.title,
              collection_label: entry.col._tile_label,
              collection_score: entry.col._score,
            }));
          });
        });

        // Tail — products not in any feature collection
        allProducts.forEach(function (p) {
          if (byId[p.shopify_product_id]) return;
          byId[p.shopify_product_id] = true;
          ordered.push(p);
        });

        var collections_list = topFeatureCols.map(function (col) {
          var match = cols.find(function (e) { return e.col.handle === col.handle; });
          return {
            handle: col.handle,
            title: col.title,
            label: col._tile_label,
            score: col._score,
            count: match ? match.products.length : 0,
            image: col.image && col.image.src ? col.image.src : null,
          };
        }).filter(function (c) { return c.count > 0; });

        var catalog = { products: ordered, feature_collections: collections_list };
        if (_cncgEl) _cncgEl._cncgCatalog = catalog;
        cb(catalog);
      });
    });
  }

  function _renderCollectionTiles(msgs, collections) {
    if (!collections || !collections.length) return;
    var bar = document.createElement('div');
    bar.className = '_btgv_cncg_chips';
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:6px 0;';
    collections.forEach(function (col) {
      var chip = document.createElement('button');
      chip.className = '_btgv_cncg_chip';
      chip.style.cssText = 'background:#f3f0ff;color:#5b21b6;border:1px solid #e9d5ff;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;';
      chip.textContent = col.label + ' · ' + col.count;
      chip.onclick = function () { _cncgShowColProductsByHandle(msgs, col); };
      bar.appendChild(chip);
    });
    msgs.appendChild(bar);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function _cncgShowColProductsByHandle(msgs, col) {
    _cncgAddUser(msgs, col.label);
    var typing = _cncgTyping(msgs);
    fetch('/collections/' + col.handle + '/products.json?limit=20')
      .then(function (r) { return r.ok ? r.json() : { products: [] }; })
      .then(function (data) {
        typing.remove();
        var normalized = (data.products || []).map(_normalizeColProduct).filter(Boolean);
        // In-stock first, recent first, on-sale boost
        normalized.sort(_dealRanker);
        if (!normalized.length) {
          _cncgAddBot(msgs, "Hmm — nothing in this collection right now. Try another?");
          _cncgBackChip(msgs); return;
        }
        _cncgAddBot(msgs, col.title + " — here's what's in stock right now ✨");
        _cncgRenderProducts(msgs, normalized.slice(0, 12), { showNegotiate: true });
        _cncgBackChip(msgs);
      })
      .catch(function () {
        typing.remove();
        _cncgAddBot(msgs, "Couldn't load that collection. Try another!");
        _cncgBackChip(msgs);
      });
  }

  // Sort: in-stock > on-sale boost > recent > collection-score boost > price desc
  function _dealRanker(a, b) {
    if (a.available !== b.available) return a.available ? -1 : 1;
    var saleA = parseFloat(a.compare_at_price || 0) > parseFloat(a.price || 0) ? 1 : 0;
    var saleB = parseFloat(b.compare_at_price || 0) > parseFloat(b.price || 0) ? 1 : 0;
    if (saleA !== saleB) return saleB - saleA;
    var colA = a.collection_score || 0;
    var colB = b.collection_score || 0;
    if (colA !== colB) return colB - colA;
    if (a.created_at && b.created_at && a.created_at !== b.created_at) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    return parseFloat(b.price || 0) - parseFloat(a.price || 0);
  }

  // ── Deals — collection-driven curation + suggestion tiles ───────────────────
  function _cncgDeals(msgs) {
    // If products are already in view, negotiate the first one directly — no discovery needed
    if (_cncgEl && _cncgEl._lastShownProducts && _cncgEl._lastShownProducts.length) {
      var ctxProd = _cncgEl._lastShownProducts[0];
      var shortName = (ctxProd.product_name || ctxProd.title || '').split(' ').slice(0, 4).join(' ');
      _cncgAddBot(msgs, 'Ooh, let me work on getting you a better price on ' + (shortName || 'this') + '! Opening the offer now... 🤝');
      setTimeout(function () { _navProductInNewTab(ctxProd, true); }, 600);
      return;
    }

    var _allDealPhrases = [
      'Pulling collections — new, best sellers, sale…',
      'Finding what\'s in stock right now…',
      'Sorting through what\'s fresh and dealworthy…',
      'Pulling out the hidden gems…',
      'Lining up the best 20 picks…',
      'Locking in your personalized picks…',
    ];
    var shuffled = _allDealPhrases.slice().sort(function () { return Math.random() - 0.5; });
    var typing = _cncgTyping(msgs, shuffled.slice(0, 3));

    var elapsed = 0, interval = 50, target = 2400;
    var waitTimer = setInterval(function () { elapsed += interval; }, interval);

    _fetchCollectionDealsCatalog(function (catalog) {
      var remaining = Math.max(0, target - elapsed);
      clearInterval(waitTimer);
      setTimeout(function () {
        typing.remove();

        var inStock = (catalog.products || []).filter(function (p) { return p.available !== false; });
        // If nothing reports availability, fall back to whole catalog
        var pool = inStock.length ? inStock : (catalog.products || []);

        if (!pool.length) {
          _cncgAddBot(msgs, "I couldn't pull the product list right now — try browsing by collection instead!");
          var ws = _chipWatchShop(), find = _chipFind();
          _cncgAddChips(msgs, _buildChips(msgs, [{ label: ws.label, fn: ws.fn }, { label: find.label, fn: find.fn }]));
          return;
        }

        pool.sort(_dealRanker);
        var top = pool.slice(0, 24);

        _cncgAddBot(msgs, "I've handpicked these from your store's collections — fresh, in stock, dealworthy. Tap \"Offer\" on any to negotiate. 🤝");
        if (catalog.feature_collections && catalog.feature_collections.length) {
          _renderCollectionTiles(msgs, catalog.feature_collections);
        }
        _cncgRenderProducts(msgs, top, { showNegotiate: true });
        _cncgBackChip(msgs);
      }, remaining);
    });
  }

  // ── Browse Collections — Shopify AJAX product collections ───────────────────
  function _cncgBrowse(msgs) {
    var typing = _cncgTyping(msgs);
    fetch('/collections.json?limit=20')
      .then(function (r) { return r.ok ? r.json() : { collections: [] }; })
      .then(function (data) {
        typing.remove();
        var cols = (data.collections || []).filter(function (c) { return c.handle !== 'all'; }).slice(0, 12);
        if (!cols.length) {
          _cncgAddBot(msgs, "No collections found. Try searching instead! 🔍");
          _cncgBackChip(msgs); return;
        }
        _cncgAddBot(msgs, "Here are our collections 🛍️ Tap one to browse products!");
        var carousel = document.createElement('div'); carousel.className = '_btgv_cncg_ccarousel';
        cols.forEach(function (col) {
          var tile = document.createElement('div'); tile.className = '_btgv_cncg_ctile';
          tile.onclick = function () { _cncgShowColProducts(msgs, col); };
          var ring = document.createElement('div'); ring.className = '_btgv_cncg_ctile_ring';
          var inner = document.createElement('div'); inner.className = '_btgv_cncg_ctile_inner';
          if (col.image && col.image.src) { var img = document.createElement('img'); img.src = col.image.src; img.alt = ''; inner.appendChild(img); } else { inner.textContent = '🛍️'; }
          ring.appendChild(inner);
          var nm = document.createElement('div'); nm.className = '_btgv_cncg_ctile_nm'; nm.textContent = col.title;
          tile.appendChild(ring); tile.appendChild(nm); carousel.appendChild(tile);
        });
        msgs.appendChild(carousel);
        _cncgBackChip(msgs);
        msgs.scrollTop = msgs.scrollHeight;
      })
      .catch(function () {
        typing.remove();
        _cncgAddBot(msgs, "Couldn't load collections. Try searching instead!");
        _cncgBackChip(msgs);
      });
  }

  function _cncgShowColProducts(msgs, col) {
    _cncgAddUser(msgs, col.title);
    var typing = _cncgTyping(msgs);
    fetch('/collections/' + col.handle + '/products.json?limit=8')
      .then(function (r) { return r.ok ? r.json() : { products: [] }; })
      .then(function (data) {
        typing.remove();
        var products = data.products || [];
        if (!products.length) {
          _cncgAddBot(msgs, "No products in this collection yet. Check back soon!");
          _cncgBackChip(msgs); return;
        }
        _cncgAddBot(msgs, col.title + ' — ' + products.length + ' product' + (products.length !== 1 ? 's' : '') + ' 🛍️');
        var normalized = products.map(function (p) {
          var v = p.variants && p.variants[0];
          return { title: p.title, handle: p.handle, image: (p.images && p.images[0] && p.images[0].src) || '', price: v ? v.price : '0', compare_at_price: v ? (v.compare_at_price || '0') : '0', variant_id: v ? v.id : null };
        }).filter(function (p) { return p.variant_id; });
        _cncgRenderProducts(msgs, normalized);
      })
      .catch(function () {
        typing.remove();
        _cncgAddBot(msgs, "Couldn't load products. Try again!");
        _cncgBackChip(msgs);
      });
  }

  // ── Find — dynamic chips from real store data ────────────────────────────────
  function _cncgFind(msgs) {
    _cncgAddBot(msgs, "What are you looking for? 🔍 Tell me anything — price range, occasion, who it's for...");

    // Build chips from real catalog + collections
    var catalog = [];
    if (_cncgEl && _cncgEl._feedItems) {
      _cncgEl._feedItems.forEach(function (v) {
        if (v._type !== 'product' && v.video_product_tags) {
          v.video_product_tags.forEach(function (t) {
            if (!catalog.some(function (p) { return p.shopify_product_id === t.shopify_product_id; })) catalog.push(t);
          });
        }
      });
    }

    function buildChips(cols) {
      var chips = [];

      // Top 3 collections as chips
      var filtered = (cols || []).filter(function (c) { return c.handle !== 'all'; }).slice(0, 3);
      filtered.forEach(function (col) {
        chips.push({ label: col.title, fn: function () { _cncgSend('Show me ' + col.title, msgs, _cncgEl._inp, _cncgEl._sendBtn); } });
      });

      // Smart price chip — round to nearest $10 below median
      if (catalog.length) {
        var prices = catalog.map(function (p) { return parseFloat(p.price || 0); }).filter(function (p) { return p > 0; }).sort(function (a, b) { return a - b; });
        if (prices.length) {
          var median = prices[Math.floor(prices.length / 2)];
          var threshold = Math.ceil(median / 10) * 10;
          chips.push({ label: 'Under $' + threshold + ' 💸', fn: function () { _cncgSend('Show me products under $' + threshold, msgs, _cncgEl._inp, _cncgEl._sendBtn); } });
        }
      }

      // Sale chip — only if sale items actually exist
      var hasSale = catalog.some(function (p) { return parseFloat(p.compare_at_price || 0) > parseFloat(p.price || 0); });
      if (hasSale) chips.push({ label: 'On sale 🏷️', fn: function () { _cncgSend('Show me products on sale', msgs, _cncgEl._inp, _cncgEl._sendBtn); } });

      // Fallback if nothing loaded yet
      if (!chips.length) {
        chips.push({ label: 'Best sellers 🔥', fn: function () { _cncgSend('Best sellers', msgs, _cncgEl._inp, _cncgEl._sendBtn); } });
        chips.push({ label: 'New arrivals ✨', fn: function () { _cncgSend('New arrivals', msgs, _cncgEl._inp, _cncgEl._sendBtn); } });
      }

      _cncgAddChips(msgs, chips);
      setTimeout(function () { if (_cncgEl && _cncgEl._inp) _cncgEl._inp.focus(); }, 250);
    }

    // Fetch collections to use as chips, fall back immediately if slow
    var chipsBuilt = false;
    var fallbackTimer = setTimeout(function () {
      if (!chipsBuilt) { chipsBuilt = true; buildChips([]); }
    }, 1200);

    fetch('/collections.json?limit=8')
      .then(function (r) { return r.ok ? r.json() : { collections: [] }; })
      .then(function (d) {
        if (!chipsBuilt) { chipsBuilt = true; clearTimeout(fallbackTimer); buildChips(d.collections || []); }
      })
      .catch(function () {
        if (!chipsBuilt) { chipsBuilt = true; clearTimeout(fallbackTimer); buildChips([]); }
      });
  }

  // ── Typing indicator helper ──────────────────────────────────────────────────
  var _typingPhrases = ['Searching the <em>catalog</em>…', 'Curating finds…', 'Hunting down the best…', 'Finding perfect matches…', 'Looking up information…', 'Sifting through products…'];
  function _cncgTyping(msgs, customPhrases) {
    var phrases = customPhrases || _typingPhrases;
    var el = document.createElement('div'); el.className = '_btgv_cncg_typing';
    var dots = document.createElement('div'); dots.className = '_btgv_cncg_typing_dots';
    for (var i = 0; i < 3; i++) dots.appendChild(document.createElement('span'));
    el.appendChild(dots);
    var hint = document.createElement('span'); hint.className = '_btgv_cncg_typing_hint';
    hint.innerHTML = phrases[0]; el.appendChild(hint);
    var idx = 0;
    var iv = setInterval(function () {
      idx = (idx + 1) % phrases.length;
      hint.style.opacity = '0';
      setTimeout(function () { hint.innerHTML = phrases[idx]; hint.style.opacity = '1'; }, 150);
    }, 900);
    msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
    return { remove: function () { clearInterval(iv); el.remove(); } };
  }

  // ── Chat history persistence (24h TTL, unlimited messages) ─────────────────
  var _CHAT_KEY = '_btgv_chat_v2_' + API_KEY;
  var _CHAT_TTL = 86400000;

  function _cncgSaveMsg(role, text) {
    try {
      var raw = localStorage.getItem(_CHAT_KEY);
      var data = raw ? JSON.parse(raw) : { ts: Date.now(), msgs: [] };
      // Refresh TTL on each message
      data.ts = Date.now();
      data.msgs.push({ r: role, t: text });
      localStorage.setItem(_CHAT_KEY, JSON.stringify(data));
    } catch (e) {}

    // Mirror to the server-side thread so /dashboard/leads sees the
    // full conversation. Fire-and-forget — never block the UI.
    try {
      var sessionId = _getOrInitSessionId();
      var ctx = _getPageContext();
      var pageContext = {
        page_type: ctx.type,
        product_url: ctx.type === 'product' ? window.location.href : null,
      };
      fetch(API_BASE + '/api/concierge/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({
          session_id: sessionId,
          role: role === 'b' ? 'assistant' : 'user',
          content: text,
          page_context: pageContext,
        }),
      }).catch(function () {});
    } catch (e) {}
  }

  // Reuses the n.js localStorage session if present; otherwise mints one.
  // This way the same session_id is shared across n.js + video.js so the
  // leads dashboard sees one continuous concierge thread per browser.
  function _getOrInitSessionId() {
    try {
      var raw = localStorage.getItem('_botiga_session');
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.session_id) return s.session_id;
      }
    } catch (e) {}
    var id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('_botiga_session', JSON.stringify({ session_id: id, ts: Date.now() })); } catch (e) {}
    return id;
  }

  // ── Funnel events ──────────────────────────────────────────────────────
  // Fire-and-forget POST that records the visitor crossing a stage. Server
  // dedupes per (merchant, session, stage) so re-firing is safe.
  function _btgvFireFunnelEvent(stage, metadata) {
    try {
      var sessionId = _getOrInitSessionId();
      fetch(API_BASE + '/api/visitor/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ session_id: sessionId, stage: stage, metadata: metadata || null }),
      }).catch(function () {});
    } catch (e) {}
  }

  // ── Dwell tracker ──────────────────────────────────────────────────────
  // Tracks time spent on the current product page (URL /products/{handle})
  // and ships a batch every 30s + on pagehide. Pauses while the tab is
  // hidden (visibilitychange) and while the chat is open. Server adds
  // (not replaces), so multiple batches accumulate.
  (function () {
    var match = window.location.pathname.match(/\/products\/([^/?#]+)/);
    if (!match) return;                    // not a product page
    var handle = match[1];
    var lastTickAt = Date.now();
    var batchedSeconds = 0;
    var BATCH_INTERVAL_MS = 30_000;
    var TICK_MS = 1000;

    function isPaused() {
      if (document.visibilityState === 'hidden') return true;
      // Chat being open = engagement, not browsing. Don't double-count.
      if (typeof _cncgOpen !== 'undefined' && _cncgOpen) return true;
      return false;
    }

    var tickTimer = setInterval(function () {
      var now = Date.now();
      var elapsed = now - lastTickAt;
      lastTickAt = now;
      if (!isPaused() && elapsed > 0 && elapsed < TICK_MS * 5) {
        batchedSeconds += elapsed / 1000;
      }
    }, TICK_MS);

    function flush() {
      if (batchedSeconds < 1) return;
      var secs = Math.round(batchedSeconds);
      batchedSeconds = 0;
      try {
        var sessionId = _getOrInitSessionId();
        var dwell_map = {};
        dwell_map[handle] = secs;
        var url = API_BASE + '/api/visitor/dwell';
        var body = JSON.stringify({ session_id: sessionId, dwell_map: dwell_map });
        // sendBeacon if available — survives pagehide. Fall back to fetch.
        if (navigator.sendBeacon) {
          var blob = new Blob([body], { type: 'application/json' });
          // sendBeacon doesn't carry custom headers, so we put api key in URL
          navigator.sendBeacon(url + '?k=' + encodeURIComponent(API_KEY), blob);
        } else {
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
            body: body,
            keepalive: true,
          }).catch(function () {});
        }
      } catch (e) {}
    }

    var batchTimer = setInterval(flush, BATCH_INTERVAL_MS);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
  })();

  // Fire 'arrived' the moment the widget loads on any page.
  setTimeout(function () { _btgvFireFunnelEvent('arrived', { path: window.location.pathname }); }, 800);

  function _cncgGetMsgHistory() {
    try {
      var raw = localStorage.getItem(_CHAT_KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      if (!data || !data.ts || !data.msgs) return [];
      if (Date.now() - data.ts > _CHAT_TTL) { localStorage.removeItem(_CHAT_KEY); return []; }
      return data.msgs;
    } catch (e) { return []; }
  }

  function _cncgClearHistory() {
    try { localStorage.removeItem(_CHAT_KEY); } catch (e) {}
    _cncgHistory = [];
  }

  // ── Customer profile — remembers what they like, budget signals, viewed products ──
  var _PROFILE_KEY = '_btgv_profile_' + API_KEY;

  function _cncgGetProfile() {
    try {
      var raw = localStorage.getItem(_PROFILE_KEY);
      return raw ? JSON.parse(raw) : { viewedProducts: [], priceSignals: [], interests: [], negotiated: [] };
    } catch (e) { return { viewedProducts: [], priceSignals: [], interests: [], negotiated: [] }; }
  }

  function _cncgUpdateProfile(update) {
    try {
      var p = _cncgGetProfile();
      if (update.viewedProduct) {
        // Keep last 10 unique viewed products
        p.viewedProducts = p.viewedProducts.filter(function (v) { return v.name !== update.viewedProduct.name; });
        p.viewedProducts.unshift(update.viewedProduct);
        if (p.viewedProducts.length > 10) p.viewedProducts = p.viewedProducts.slice(0, 10);
      }
      if (update.priceSignal) {
        p.priceSignals.push(update.priceSignal);
        if (p.priceSignals.length > 20) p.priceSignals = p.priceSignals.slice(-20);
      }
      if (update.interest) {
        if (!p.interests.includes(update.interest)) p.interests.push(update.interest);
      }
      if (update.negotiated) {
        p.negotiated.push(update.negotiated);
        if (p.negotiated.length > 20) p.negotiated = p.negotiated.slice(-20);
      }
      localStorage.setItem(_PROFILE_KEY, JSON.stringify(p));
    } catch (e) {}
  }

  function _cncgProfileSummary() {
    var p = _cncgGetProfile();
    var parts = [];
    if (p.viewedProducts && p.viewedProducts.length) {
      parts.push('Recently viewed: ' + p.viewedProducts.slice(0, 5).map(function (v) { return v.name + ' ($' + v.price + ')'; }).join(', '));
    }
    if (p.negotiated && p.negotiated.length) {
      parts.push('Has negotiated: ' + p.negotiated.map(function (n) { return n.name + ' → $' + n.dealPrice; }).join(', '));
    }
    if (p.interests && p.interests.length) {
      parts.push('Interested in: ' + p.interests.join(', '));
    }
    if (p.priceSignals && p.priceSignals.length) {
      var maxWilling = Math.max.apply(null, p.priceSignals.map(function (s) { return s.accepted || 0; }).filter(Boolean));
      if (maxWilling > 0) parts.push('Has accepted prices up to $' + maxWilling);
    }
    return parts.join('. ');
  }

  function _cncgAddBot(msgs, text, ephemeral) {
    var el = document.createElement('div'); el.className = '_btgv_cncg_bot'; el.textContent = text;
    msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
    if (!ephemeral) _cncgSaveMsg('b', text);
    return el;
  }

  function _cncgAddUser(msgs, text, ephemeral) {
    var el = document.createElement('div'); el.className = '_btgv_cncg_usr'; el.textContent = text;
    msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
    if (!ephemeral) _cncgSaveMsg('u', text);
  }

  // ── Local keyword search fallback (no LLM needed) ───────────────────────────
  function _cncgLocalSearch(query) {
    var q = (query || '').toLowerCase();
    var all = [];
    if (_cncgEl && _cncgEl._feedItems) {
      _cncgEl._feedItems.forEach(function (v) {
        if (v._type !== 'product' && v.video_product_tags) {
          v.video_product_tags.forEach(function (t) {
            if (!all.some(function (p) { return p.shopify_product_id === t.shopify_product_id; })) all.push(t);
          });
        }
      });
    }
    return all.filter(function (t) {
      var price = parseFloat(t.price || 0), was = parseFloat(t.compare_at_price || 0);
      var nm = (t.product_name || '').toLowerCase();
      if (/under\s*\$?\s*(\d+)/.test(q)) { var lim = parseInt(q.match(/under\s*\$?\s*(\d+)/)[1]); return price < lim; }
      if (/sale|discount|deal|off/.test(q)) return was > price;
      if (/best.?sell|popular|trending/.test(q)) return true;
      if (/new|arriv|latest/.test(q)) return true;
      var words = q.split(/\s+/).filter(function (w) { return w.length > 2; });
      return words.some(function (w) { return nm.includes(w); });
    });
  }

  // ── After "Keep shopping": proactively suggest more options + a checkout escape ─
  function _cncgShowMoreOptions() {
    if (!_cncgOpen) openConcierge();
    if (!_cncgEl) return;
    var msgs = _cncgEl._msgs;
    if (!msgs) return;

    var deals = (typeof _btgvGetDeals === 'function') ? _btgvGetDeals() : [];
    var greet = deals.length > 1
      ? "Love that — you're stacking up wins. Here are more pieces I'd add to your haul: 🛍️"
      : "Nice grab! Want to layer in something else? These are my next favorites for you: ✨";
    _cncgAddBot(msgs, greet);

    var typing = _cncgTyping(msgs, ['Curating your next picks…', 'Pulling complementary finds…', 'Looking at what pairs well…']);

    function loadAndShow() {
      var shopifyProducts = (_cncgEl && _cncgEl._shopifyProducts) || [];
      if (!shopifyProducts.length) {
        fetch('/products.json?limit=150')
          .then(function (r) { return r.ok ? r.json() : { products: [] }; })
          .then(function (d) {
            if (_cncgEl) _cncgEl._shopifyProducts = d.products || [];
            renderPicks(_cncgEl._shopifyProducts || []);
          }).catch(function () { renderPicks([]); });
      } else {
        renderPicks(shopifyProducts);
      }
    }

    function renderPicks(shopifyProducts) {
      typing.remove();
      var picks = (shopifyProducts || []).map(function (p) {
        var v = p.variants && p.variants[0];
        if (!v) return null;
        return {
          id: String(p.id), name: p.title, product_name: p.title,
          price: v.price, compare_at_price: v.compare_at_price || '0',
          handle: p.handle, image_url: (p.images && p.images[0] && p.images[0].src) || '',
          variant_id: v.id, shopify_variant_id: v.id, shopify_product_id: String(p.id)
        };
      }).filter(Boolean);

      // Prioritize items on sale (more negotiation room)
      picks.sort(function (a, b) {
        var aHas = parseFloat(a.compare_at_price || 0) > parseFloat(a.price || 0) ? 1 : 0;
        var bHas = parseFloat(b.compare_at_price || 0) > parseFloat(b.price || 0) ? 1 : 0;
        return bHas - aHas;
      });

      _btgvFilterShown(picks.slice(0, 16), function (filtered) {
        if (!filtered.length) {
          _cncgAddBot(msgs, "Looks like you've covered the highlights — ready to checkout?");
          _cncgAddChips(msgs, _buildChips(msgs, [
            { label: '⚡ Checkout', fn: function () { _cncgCelebrateAndGo(_cncgPickCheckoutDest()); }},
            { label: '🛍️ Browse all', fn: function (m) { _cncgMainMenu(m); }}
          ]));
          return;
        }
        _cncgRenderProducts(msgs, filtered.slice(0, 6), { showNegotiate: true });
        _cncgAddChips(msgs, _buildChips(msgs, [
          { label: '⚡ Checkout', fn: function () { _cncgCelebrateAndGo(_cncgPickCheckoutDest()); }},
          { label: '🔍 Show me something else', fn: function (m) { _cncgFind(m); }}
        ]));
      });
    }

    setTimeout(loadAndShow, 400);
  }

  // Cross-widget hook so n.js can ask the concierge to take over after "Keep shopping"
  document.addEventListener('botiga:show-recommendations', function () {
    _cncgShowMoreOptions();
  });

  // ── Big "Deal Done, Darling!" celebration — shown only when user heads to checkout ─
  function _cncgCelebrateAndGo(url) {
    if (!_cncgEl) { window.location.href = url; return; }
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(180deg,#0a0a0a,#1a1a2e);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:2147483647;border-radius:inherit;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:32px;';
    overlay.innerHTML =
      '<div style="font-size:28px;font-weight:800;letter-spacing:0.3px;margin-bottom:14px">Deal Done, Darling! 🎉</div>' +
      '<svg viewBox="0 0 52 52" width="64" height="64" style="margin-bottom:14px">' +
        '<circle cx="26" cy="26" r="24" fill="none" stroke="#22c55e" stroke-width="3"/>' +
        '<path fill="none" stroke="#22c55e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M14 27l8 8 16-16"/>' +
      '</svg>' +
      '<div style="font-size:14px;color:#aaa">Taking you to checkout…</div>';
    _cncgEl.appendChild(overlay);
    setTimeout(function () { window.location.href = url; }, 1200);
  }

  // ── Natural-language intents handled before the LLM call ────────────────────
  function _cncgDetectIntent(text) {
    var t = (text || '').toLowerCase().trim();
    // Reject if too long — likely a real question, not a command
    if (t.length > 60) return null;
    if (/^(check\s*out|checkout|go to checkout|take me to checkout|let'?s checkout|i'?ll buy|buy (it|this)( now)?|complete (my )?purchase|pay now|finish( my)? order)\.?!?$/i.test(t)) {
      return 'checkout';
    }
    if (/^(add (it|this)?( to)? cart|add to (the )?cart|put (it|this) in (my )?cart|add to bag|cart it)\.?!?$/i.test(t)) {
      return 'add_to_cart';
    }
    // Variant-specific add: "add size 6", "add medium", "add the small in red",
    // "add it in red", "add 8 to cart" — triggers the inline variant picker
    // when on a product page (REP AI parity).
    if (/^add\s+(it\s+)?(in\s+\w+|size\s+[\w-]+|x?s|sm|small|m|med|medium|l|lg|large|xl|xxl|2xl|3xl|the\s+\w+|\d+)/i.test(t)) {
      return 'add_to_cart';
    }
    return null;
  }

  // Parse size + color hints out of a free-form add-to-cart message.
  // "add size 6 in red to cart" → { size: '6', color: 'red' }.
  function _cncgParseVariantHints(text) {
    var t = (text || '').toLowerCase();
    var size = null, color = null;
    var sizeM = t.match(/(?:size\s*)([0-9]{1,2}|x?s|sm|small|m|med|medium|l|lg|large|xl|xxl|2xl|3xl)\b/);
    if (sizeM) size = sizeM[1];
    else {
      var bareM = t.match(/^add\s+(?:it\s+)?(\d{1,2}|x?s|sm|small|m|med|medium|l|lg|large|xl|xxl|2xl|3xl)\b/);
      if (bareM) size = bareM[1];
    }
    var colorM = t.match(/\bin\s+([a-z]+(?:\s+[a-z]+)?)\b/);
    if (colorM) color = colorM[1].trim();
    return { size: size, color: color };
  }

  // Product-discovery intent — anything that smells like the customer
  // is asking us to find something. Triggers the deterministic filter
  // card UI instead of a free LLM round-trip. Conservative — false
  // positives here block LLM responses to legit questions, so we err
  // toward only well-shaped queries.
  function _cncgDetectDiscoveryIntent(text) {
    if (!text) return false;
    var t = String(text).toLowerCase();
    if (t.length > 120) return false;
    // Phrasing hints
    if (/\bshow\s+me\b|\bdo\s+you\s+have\b|\bdo\s+you\s+sell\b|\blooking\s+for\b|\brecommend\b|\bsuggest\b|\bsearch\b|\bbrowse\b|\bany\s+(other|more|cheaper|different)\b|\bwhat'?s\s+(new|hot|trending|on\s+sale|good)\b/.test(t)) return true;
    // Price-bound queries
    if (/(under|below|less\s+than|<=?|max(?:imum)?|up\s+to)\s*\$?\s*\d+/.test(t)) return true;
    // Category + qualifier ("yellow tops", "summer dresses")
    if (/\b(dress|dresses|top|tops|shirt|bag|bags|shoe|shoes|jewelry|gift|gifts|present|presents|item|items|outfit|jacket|coat|skirt|pants|jeans|sweater|cardigan|sandals|necklace|earring|bracelet|ring|hat|scarf|belt|sneakers|boots|heels)\b/.test(t)) return true;
    // Sort hints
    if (/\bbest\s*sellers?\b|\bnew\s+arrivals?\b|\btrending\b|\bpopular\b|\bdeals?\b|\bsale\b|\bjust\s+in\b/.test(t)) return true;
    return false;
  }

  // ── Filter card UI ──────────────────────────────────────────────────────
  // Renders a card with chips for each filter dimension, pre-selected
  // from the parsed query. Tap any chip → re-query the deterministic
  // backend → re-render the product list below. The LLM is never in
  // this loop; results are predictable and fast.
  function _cncgRunProductSearch(msgs, queryText, explicitFilter) {
    try { _btgvFireFunnelEvent('discovered', { query: queryText || null }); } catch (_) {}
    var typing = _cncgTyping(msgs, [
      'Searching the <em>catalog</em>…',
      '✨ Pulling fresh picks for you…',
      '🛍️ Sorting your faves…',
    ]);
    var sessionId = _getOrInitSessionId();
    var body = {
      k: API_KEY,
      query: queryText || '',
      filter: explicitFilter || null,
      session_id: sessionId,
      limit: 100,
    };
    fetch(API_BASE + '/api/widget/product-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        typing.remove();
        if (!d || !d.products) {
          _cncgAddBot(msgs, "🤔 Couldn't pull the catalog right this second — give it a moment and try again?");
          _cncgBackChip(msgs);
          return;
        }
        if (d.products.length === 0) {
          _cncgAddBot(msgs, "🤔 Nothing matched those filters yet. Loosen one below 👇 and I'll re-run it.");
          _cncgRenderFilterCard(msgs, d.filter, d.dimensions);
          return;
        }
        var emoji = d.products.length >= 30 ? '🎉' : d.products.length >= 10 ? '✨' : '🎁';
        _cncgAddBot(msgs, emoji + " Got " + d.products.length + " picks for you 🛍️ Tap any to negotiate 🤝");
        _cncgRenderFilterCard(msgs, d.filter, d.dimensions);
        _cncgRenderSearchResults(msgs, d.products);
        _cncgBackChip(msgs);
      })
      .catch(function () {
        typing.remove();
        _cncgAddBot(msgs, "😕 Search hit an error — try rephrasing?");
      });
  }

  // Render the filter chips. Tapping a chip mutates the filter and
  // re-runs the search. No LLM in the loop.
  function _cncgRenderFilterCard(msgs, filter, dims) {
    var card = document.createElement('div');
    card.className = '_btgv_filtercard';
    card.style.cssText = 'background:#0c0c14;color:#fff;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px;margin:8px 0;font-family:inherit;';

    function section(title, children) {
      if (!children || !children.length) return null;
      var s = document.createElement('div');
      s.style.cssText = 'margin-bottom:10px;';
      var lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;';
      lbl.textContent = title;
      s.appendChild(lbl);
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
      children.forEach(function (c) { row.appendChild(c); });
      s.appendChild(row);
      return s;
    }

    function chip(label, active, onClick) {
      var b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'background:' + (active ? 'linear-gradient(135deg,#0ea5e9,#7c3aed)' : 'rgba(255,255,255,.06)') +
                       ';color:' + (active ? '#fff' : '#d1d5db') +
                       ';border:1px solid ' + (active ? 'transparent' : 'rgba(255,255,255,.1)') +
                       ';border-radius:999px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;';
      b.onclick = function (e) { e.stopPropagation(); onClick(); };
      return b;
    }

    function reRun(newFilter) {
      // Replace this card and the results below with fresh ones
      var nextSibling = card;
      var siblings = [];
      while (nextSibling && nextSibling.nextSibling) {
        var s = nextSibling.nextSibling;
        if (s.classList && (s.classList.contains('_btgv_filterresults') || s.classList.contains('_btgv_cncg_chips'))) {
          siblings.push(s);
          nextSibling = s;
        } else break;
      }
      siblings.forEach(function (el) { el.remove(); });
      card.remove();
      _cncgRunProductSearch(msgs, '', newFilter);
    }

    // Sort
    var sortChips = (dims.sort_options || []).map(function (s) {
      var lbl = ({ newest: '⭐ Newest', best_sellers: '🔥 Best sellers', deals: '💰 Best deals', featured: '✨ Featured' })[s] || s;
      return chip(lbl, filter.sort === s, function () {
        reRun(Object.assign({}, filter, { sort: filter.sort === s ? null : s }));
      });
    });
    var sortSec = section('Sort by', sortChips); if (sortSec) card.appendChild(sortSec);

    // Budget
    var budgetChips = (dims.price_buckets || []).map(function (n) {
      return chip('under $' + n, filter.price_max === n, function () {
        reRun(Object.assign({}, filter, { price_max: filter.price_max === n ? null : n }));
      });
    });
    budgetChips.push(chip('any', filter.price_max == null, function () {
      reRun(Object.assign({}, filter, { price_max: null }));
    }));
    card.appendChild(section('Budget', budgetChips));

    // Categories — top tags from catalog
    var tagChips = (dims.tags || []).slice(0, 8).map(function (t) {
      var active = filter.category && filter.category.kind === 'tag' && filter.category.value === t.tag;
      return chip(t.tag, active, function () {
        reRun(Object.assign({}, filter, { category: active ? null : { kind: 'tag', value: t.tag } }));
      });
    });
    var catSec = section('Category', tagChips); if (catSec) card.appendChild(catSec);

    // Colors
    var colorChips = (dims.colors || []).map(function (c) {
      return chip(c, filter.color === c, function () {
        reRun(Object.assign({}, filter, { color: filter.color === c ? null : c }));
      });
    });
    var colSec = section('Color', colorChips); if (colSec) card.appendChild(colSec);

    // Sizes
    var sizeChips = (dims.sizes || []).map(function (s) {
      return chip(s.toUpperCase(), filter.size === s, function () {
        reRun(Object.assign({}, filter, { size: filter.size === s ? null : s }));
      });
    });
    var sizeSec = section('Size', sizeChips); if (sizeSec) card.appendChild(sizeSec);

    // Reset
    var reset = document.createElement('button');
    reset.textContent = '✕ Reset all';
    reset.style.cssText = 'background:none;border:none;color:#6b7280;font-size:11px;cursor:pointer;padding:4px 0;font-family:inherit;text-decoration:underline;';
    reset.onclick = function (e) {
      e.stopPropagation();
      reRun({ raw: '', sort: null, price_max: null, price_min: null, color: null, size: null, category: null });
    };
    card.appendChild(reset);

    msgs.appendChild(card);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // Render up to 50 product tiles below the filter card. Each tile uses
  // the existing _cncgRenderProducts flow which already wires Negotiate/
  // Cart/Save buttons consistently.
  function _cncgRenderSearchResults(msgs, products) {
    var wrap = document.createElement('div');
    wrap.className = '_btgv_filterresults';
    wrap.style.cssText = 'margin:6px 0;';
    msgs.appendChild(wrap);

    // Reuse the standard product rendering. It expects products in the
    // same compact shape we return from /widget/product-search.
    var normalized = (products || []).map(function (p) {
      return {
        title: p.title,
        product_name: p.title,
        handle: p.handle,
        image: p.image_url,
        image_url: p.image_url,
        price: p.price,
        compare_at_price: p.compare_at_price || '0',
        variant_id: (p.variants && p.variants[0] && p.variants[0].id) || null,
        shopify_product_id: p.id,
      };
    });
    _cncgRenderProducts(wrap, normalized, { showNegotiate: true });
  }

  function _cncgPickAddToCartTarget() {
    // Prefer the product page the user is on
    var m = window.location.pathname.match(/\/products\/([^/?#]+)/);
    if (m && _cncgEl && _cncgEl._shopifyProducts) {
      var handle = m[1];
      for (var i = 0; i < _cncgEl._shopifyProducts.length; i++) {
        var p = _cncgEl._shopifyProducts[i];
        if (p.handle === handle && p.variants && p.variants[0]) {
          return { variantId: p.variants[0].id, name: p.title };
        }
      }
    }
    // Otherwise the most recently shown product in concierge
    if (_cncgEl && _cncgEl._lastShownProducts && _cncgEl._lastShownProducts.length) {
      var sp = _cncgEl._lastShownProducts[0];
      var vid = sp.shopify_variant_id || sp.variant_id;
      if (vid) return { variantId: vid, name: sp.product_name || sp.title || sp.name || 'this item' };
    }
    return null;
  }

  function _cncgPickCheckoutDest() {
    // Latest Draft Order invoice URL among saved deals
    var deals = (typeof _btgvGetDeals === 'function') ? _btgvGetDeals() : [];
    for (var i = deals.length - 1; i >= 0; i--) {
      if (deals[i].invoiceUrl) return deals[i].invoiceUrl;
    }
    for (var j = deals.length - 1; j >= 0; j--) {
      if (deals[j].checkoutUrl) return deals[j].checkoutUrl;
    }
    return '/checkout';
  }

  // ── In-chat negotiation (replaces the legacy openNegotiateModal flow) ────────
  // The bubble becomes the negotiation surface. Same chat surface, same brand
  // voice, same merchant theme. /api/negotiate handles the price ladder and
  // floor enforcement; we just render its replies as concierge messages.
  function _btgvStartChatNegotiation(prod, msgs) {
    if (!prod) return;
    // Callers from outside the concierge (video CTAs, PDP button, grid cards)
    // don't have a `msgs` reference. Open the bubble and grab the messages
    // element so the negotiation surfaces in the same place every time.
    if (!msgs) {
      try { if (typeof openConcierge === 'function') openConcierge(); } catch (_) {}
      msgs = _cncgEl && _cncgEl._msgs ? _cncgEl._msgs : null;
    }
    if (!msgs) return;
    if (_btgNegoChat.active && _btgNegoChat.negotiationId) {
      _cncgAddBot(msgs, "We're already on this one — counter with a number?");
      return;
    }
    var listPrice = parseFloat(prod.price || prod.list_price || 0);
    if (!(listPrice > 0)) {
      _cncgAddBot(msgs, "Hmm, I can't read the price on this one. Open the product page first?");
      return;
    }

    // Eligibility check — polite refuse if the merchant has marked this
    // product (or its tag) as non-negotiable. Don't even spin up a
    // negotiation row; just stay in conversation mode.
    var handle = prod.handle || prod.product_handle || null;
    var tags = prod.tags || [];
    _btgvFetchProductRules(handle, tags, function (rules) {
      if (rules && rules.negotiable === false) {
        _cncgAddBot(msgs, "Aw, this one's at fixed price 💌 But I can help you snag a deal on something similar — want me to look?");
        _cncgAddChips(msgs, [
          { label: '🔍 Show me similar', fn: function () { _cncgFind(msgs); } },
          { label: '🛒 Just add to cart', fn: function () {
            var vid = prod.shopify_variant_id || prod.variant_id;
            if (vid) addToCart(vid, function () { fireConfetti(); _cncgAddBot(msgs, '✓ Added to cart!'); });
          }},
        ]);
        return;
      }
      _btgvStartChatNegotiationConfirmed(prod, msgs, listPrice);
    });
  }

  function _btgvStartChatNegotiationConfirmed(prod, msgs, listPrice) {
    _btgNegoChat.active = true;
    _btgNegoChat.productInfo = prod;
    _btgNegoChat.listPrice = listPrice;
    _btgNegoChat.negotiationId = null;
    _btgvEnterNegotiationVisualMode(prod);

    var typing = _cncgTyping(msgs);
    var body = {
      session_id: _getOrInitSessionId(),
      product_name: prod.product_name || prod.title || 'this item',
      product_url: prod.product_url || (prod.handle ? '/products/' + prod.handle : null),
      product_image: prod.image_url || null,
      variant_id: prod.shopify_variant_id || prod.variant_id || null,
      list_price: listPrice,
      opening: true,
    };

    fetch(API_BASE + '/api/negotiate?k=' + API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (typing && typing.remove) typing.remove();
        if (d.error) {
          _btgNegoChat.active = false;
          _btgvExitNegotiationVisualMode();
          _cncgAddBot(msgs, "Hmm, hit a snag starting the negotiation. Try again in a sec?");
          return;
        }
        _btgNegoChat.negotiationId = d.negotiation_id;
        _cncgAddBot(msgs, d.bot_reply || "Let me see what I can do on this 💭");
        _btgNegoRenderOfferCard(d, msgs);
        try { _btgvFireFunnelEvent('negotiated', { negotiation_id: d.negotiation_id, product: prod.product_name }); } catch (_) {}
        if (d.status === 'won' && d.deal_price) { _btgNegoCloseDeal(d, msgs); return; }
        _btgNegoRenderOfferChips(d, msgs);
      })
      .catch(function () {
        if (typing && typing.remove) typing.remove();
        _btgNegoChat.active = false;
        _btgvExitNegotiationVisualMode();
        _cncgAddBot(msgs, "Hmm, couldn't reach the negotiation engine. Try again?");
      });
  }

  // Toggle the bubble's bold negotiation visual mode. The class drives all
  // the CSS (glow, tint, header swap). The subtitle also gets a "Negotiating
  // <Product>" pill so the context is unmistakable.
  function _btgvEnterNegotiationVisualMode(prod) {
    if (!_cncgEl) return;
    _cncgEl.classList.add('negotiating');
    var sub = _cncgEl.querySelector('._btgv_cncg_sub');
    if (sub) {
      if (!sub.dataset._btgvOrig) sub.dataset._btgvOrig = sub.textContent;
      sub.innerHTML = '<span class="_btgv_neg_pill">🤝 Negotiating</span> ' +
        (prod.product_name || prod.title || 'this item');
    }
  }

  function _btgvExitNegotiationVisualMode() {
    if (!_cncgEl) return;
    _cncgEl.classList.remove('negotiating');
    var sub = _cncgEl.querySelector('._btgv_cncg_sub');
    if (sub && sub.dataset._btgvOrig) {
      sub.textContent = sub.dataset._btgvOrig;
      delete sub.dataset._btgvOrig;
    }
  }

  // Airbnb-style offer card. Renders below the bot's text reply so the
  // anchored counter is impossible to miss. Customer can act with chips
  // immediately beneath — no need to read prose and parse a number.
  function _btgNegoRenderOfferCard(d, msgs) {
    if (!msgs) return;
    var offered = parseFloat(d.offered_price || d.deal_price || 0);
    if (!(offered > 0)) return;
    var prod = _btgNegoChat.productInfo || {};
    var listPrice = _btgNegoChat.listPrice || parseFloat(prod.price || 0);
    var save = listPrice - offered;
    var pct = listPrice > 0 ? Math.round((save / listPrice) * 100) : 0;

    var card = document.createElement('div');
    card.className = '_btgv_offercard';

    var hdr = document.createElement('div');
    hdr.className = '_btgv_offercard_hdr';
    if (prod.image_url) {
      var img = document.createElement('img');
      img.className = '_btgv_offercard_img';
      img.src = prod.image_url;
      img.onerror = function () { this.style.display = 'none'; };
      hdr.appendChild(img);
    }
    var info = document.createElement('div');
    info.className = '_btgv_offercard_info';
    var label = document.createElement('div');
    label.className = '_btgv_offercard_label';
    label.textContent = d.status === 'won' ? '🎉 Deal locked' : '🎁 My offer';
    var name = document.createElement('div');
    name.className = '_btgv_offercard_name';
    name.textContent = prod.product_name || prod.title || 'this item';
    info.appendChild(label);
    info.appendChild(name);
    hdr.appendChild(info);
    card.appendChild(hdr);

    var priceRow = document.createElement('div');
    priceRow.className = '_btgv_offercard_pricerow';
    var now = document.createElement('span');
    now.className = '_btgv_offercard_now';
    now.textContent = '$' + offered.toFixed(0);
    priceRow.appendChild(now);
    if (listPrice > offered) {
      var was = document.createElement('span');
      was.className = '_btgv_offercard_was';
      was.textContent = '$' + listPrice.toFixed(0);
      priceRow.appendChild(was);
    }
    if (pct > 0) {
      var sv = document.createElement('span');
      sv.className = '_btgv_offercard_save';
      sv.textContent = 'Save $' + save.toFixed(0) + ' · ' + pct + '%';
      priceRow.appendChild(sv);
    }
    card.appendChild(priceRow);

    if (d.is_final_offer) {
      var meta = document.createElement('div');
      meta.className = '_btgv_offercard_meta';
      meta.textContent = '⏳ This is my best — yours for 10 min';
      card.appendChild(meta);
    }

    msgs.appendChild(card);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // Polished chip row beneath each offer (Slice F).
  // [Accept $X] (prominent green) · [Counter] (neutral) · [Pass for now] (subtle).
  // "Pass for now" gracefully ends the negotiation without burning the deal.
  function _btgNegoRenderOfferChips(d, msgs) {
    if (!msgs) return;
    var wrap = document.createElement('div');
    wrap.className = '_btgv_negochips';

    var offered = parseFloat(d.offered_price || d.deal_price || 0);
    if (offered > 0 && d.status !== 'won') {
      var ok = document.createElement('button');
      ok.className = '_btgv_negochip_accept';
      ok.textContent = '✓ Accept $' + Math.round(offered);
      ok.onclick = function () {
        _cncgAddUser(msgs, 'I accept');
        _btgNegoSendCounter('I accept', msgs);
      };
      wrap.appendChild(ok);
    }

    if (d.status !== 'won') {
      var cn = document.createElement('button');
      cn.className = '_btgv_negochip_counter';
      cn.textContent = '💬 Counter';
      cn.onclick = function () {
        if (_cncgEl && _cncgEl._inp) {
          _cncgEl._inp.focus();
          _cncgEl._inp.placeholder = 'Type your counter-offer…';
        }
      };
      wrap.appendChild(cn);

      var pass = document.createElement('button');
      pass.className = '_btgv_negochip_pass';
      pass.textContent = 'Pass for now';
      pass.onclick = function () {
        _cncgAddUser(msgs, 'Pass for now');
        _cncgAddBot(msgs, "No pressure — I'm here whenever you want to come back to this 💌");
        _btgNegoChat.active = false;
        _btgNegoChat.negotiationId = null;
        _btgvExitNegotiationVisualMode();
      };
      wrap.appendChild(pass);
    }

    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // Page-level celebration overlay. Fires on deal accept BEFORE redirect.
  // The whole window celebrates, not just the bubble — matches the
  // emotional weight of "you just won a deal".
  function _btgvShowPageCelebration(dealPrice, discountCode, redirectUrl, productName) {
    var existing = document.getElementById('_btgv_pagewin');
    if (existing) existing.remove();

    var wrap = document.createElement('div');
    wrap.id = '_btgv_pagewin';

    var card = document.createElement('div');
    card.className = '_btgv_pagewin_card';

    var emoji = document.createElement('div');
    emoji.className = '_btgv_pagewin_emoji';
    emoji.textContent = '🎉';
    card.appendChild(emoji);

    var label = document.createElement('div');
    label.className = '_btgv_pagewin_label';
    label.textContent = 'Deal Locked';
    card.appendChild(label);

    var price = document.createElement('div');
    price.className = '_btgv_pagewin_price';
    price.textContent = '$' + Math.round(dealPrice);
    card.appendChild(price);

    if (productName) {
      var sub = document.createElement('div');
      sub.className = '_btgv_pagewin_sub';
      sub.textContent = productName;
      card.appendChild(sub);
    }

    if (discountCode) {
      var code = document.createElement('div');
      code.className = '_btgv_pagewin_code';
      code.textContent = 'Code: ' + discountCode;
      card.appendChild(code);
    }

    var hint = document.createElement('div');
    hint.className = '_btgv_pagewin_sub';
    hint.style.marginTop = '14px';
    hint.textContent = 'Heading to checkout…';
    card.appendChild(hint);

    wrap.appendChild(card);
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add('show'); });
    fireConfetti();
    setTimeout(function () { try { fireConfetti(); } catch (_) {} }, 300);
    setTimeout(function () { try { fireConfetti(); } catch (_) {} }, 700);

    setTimeout(function () {
      window.location.href = redirectUrl || '/checkout';
    }, 1800);
  }

  function _btgNegoSendCounter(text, msgs) {
    if (!_btgNegoChat.active || !_btgNegoChat.negotiationId) return false;
    var typing = _cncgTyping(msgs);
    var prod = _btgNegoChat.productInfo || {};
    var body = {
      session_id: _getOrInitSessionId(),
      negotiation_id: _btgNegoChat.negotiationId,
      list_price: _btgNegoChat.listPrice,
      customer_message: text,
      opening: false,
      product_name: prod.product_name || 'this item',
      variant_id: prod.shopify_variant_id || prod.variant_id || null,
    };
    fetch(API_BASE + '/api/negotiate?k=' + API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (typing && typing.remove) typing.remove();
        if (d.error) { _cncgAddBot(msgs, "Hmm, the engine glitched. Try again?"); return; }
        _cncgAddBot(msgs, d.bot_reply || '');
        _btgNegoRenderOfferCard(d, msgs);
        if (d.status === 'won' && d.deal_price) { _btgNegoCloseDeal(d, msgs); return; }
        if (d.status === 'lost' || d.status === 'abandoned') {
          _btgvExitNegotiationVisualMode();
          _btgNegoChat.active = false;
          _btgNegoChat.negotiationId = null;
          return;
        }
        _btgNegoRenderOfferChips(d, msgs);
      })
      .catch(function () {
        if (typing && typing.remove) typing.remove();
        _cncgAddBot(msgs, "Hmm, couldn't reach the engine. Try again?");
      });
    return true;
  }

  function _btgNegoCloseDeal(d, msgs) {
    var prod = _btgNegoChat.productInfo || {};
    var listPrice = _btgNegoChat.listPrice;
    try { _btgvFireFunnelEvent('won', { negotiation_id: d.negotiation_id, deal_price: d.deal_price }); } catch (_) {}
    _btgvSaveDeal({
      negotiationId: d.negotiation_id,
      productName: prod.product_name || '',
      listPrice: listPrice,
      price: d.deal_price,
      checkoutUrl: d.checkout_url,
      invoiceUrl: d.draft_order_invoice_url || d.checkout_url,
      draftOrderId: d.draft_order_id || null,
      lineItemId: d.draft_order_line_item_id || null,
      discountCode: d.discount_code || null,
      expiresAt: d.expires_at || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    _cncgUpdateProfile({ negotiated: { name: prod.product_name, dealPrice: Math.round(d.deal_price), listPrice: Math.round(listPrice) } });
    _cncgAddBot(msgs, '🎉 Deal locked at $' + Math.round(d.deal_price) + '! Taking you to checkout…');
    _btgNegoChat.active = false;
    _btgNegoChat.negotiationId = null;
    _btgvExitNegotiationVisualMode();
    // Page-level celebration takeover (Slice H) — the whole window
    // celebrates, then redirects to checkout. Replaces the bubble-only
    // confetti + 2s timeout pattern.
    var dest = d.checkout_url || d.draft_order_invoice_url || '/checkout';
    _btgvShowPageCelebration(d.deal_price, d.discount_code, dest, prod.product_name);
  }

  // ── LLM free-form chat with full store catalog ───────────────────────────────
  function _cncgSend(text, msgs, inp, sendBtn) {
    if (!msgs) return;
    // If a chat-mode negotiation is live, route this message through the
    // negotiation engine, not the conversational chat endpoint.
    if (_btgNegoChat.active && _btgNegoChat.negotiationId) {
      inp.value = '';
      sendBtn.disabled = false;
      _cncgAddUser(msgs, text);
      if (_cncgEl && _cncgEl._inp) _cncgEl._inp.placeholder = '';
      _btgNegoSendCounter(text, msgs);
      return;
    }
    inp.value = ''; sendBtn.disabled = true;
    _cncgAddUser(msgs, text);
    _cncgHistory.push({ role: 'user', content: text });

    // Intent shortcut — skip the LLM and just do the thing
    var intent = _cncgDetectIntent(text);
    if (intent === 'checkout') {
      var dest = _cncgPickCheckoutDest();
      sendBtn.disabled = false;
      _cncgCelebrateAndGo(dest);
      return;
    }
    // Product discovery — handle deterministically with the filter card.
    // Faster than the LLM, returns predictable results (50 picks),
    // never invents prices or products.
    if (_cncgDetectDiscoveryIntent(text)) {
      sendBtn.disabled = false;
      _cncgRunProductSearch(msgs, text, null);
      return;
    }
    if (intent === 'add_to_cart') {
      sendBtn.disabled = false;
      // On a product page → inline variant picker (REP-style). The picker
      // filters variants by any size/color hints from the user's message.
      if (_cncgGetPDPHandle()) {
        var hints = _cncgParseVariantHints(text);
        _cncgPDPVariantPicker(msgs, hints.size, hints.color);
        return;
      }
      // Otherwise fall back to single-variant add for the most-recently-shown product
      var target = _cncgPickAddToCartTarget();
      if (!target) {
        _cncgAddBot(msgs, "Tell me which one and I'll add it — or open a product first. 🛍️");
        return;
      }
      _cncgAddBot(msgs, 'Adding ' + target.name + ' to your cart…');
      addToCart(target.variantId, function (ok) {
        if (ok) {
          _btgvAttributeCart();
          _btgvInjectCartBadge();
          fireConfetti();
          _cncgAddBot(msgs, '✓ Added! Want to keep shopping or head to checkout?');
          _cncgAddChips(msgs, _buildChips(msgs, [
            { label: '⚡ Go to checkout', fn: function () { window.location.href = '/checkout'; }},
            { label: '🛍️ Keep shopping', fn: function (m) { _cncgMainMenu(m); }}
          ]));
        } else {
          _cncgAddBot(msgs, "Hmm, couldn't add it. Try opening the product page and tapping Add to cart.");
        }
      });
      return;
    }

    var typing = _cncgTyping(msgs);

    // Collect video-tagged products
    var allTags = [];
    var catalog = [];
    if (_cncgEl && _cncgEl._feedItems) {
      _cncgEl._feedItems.forEach(function (v) {
        if (v._type !== 'product' && v.video_product_tags) {
          v.video_product_tags.forEach(function (t) {
            if (!allTags.some(function (p) { return p.shopify_product_id === t.shopify_product_id; })) {
              allTags.push(t);
              catalog.push({ id: t.shopify_product_id, name: t.product_name, price: t.price, compare_at_price: t.compare_at_price, handle: t.handle || '', image_url: t.image_url || '' });
            }
          });
        }
      });
    }
    // Augment with ALL Shopify products if loaded
    if (_cncgEl && _cncgEl._shopifyProducts) {
      _cncgEl._shopifyProducts.forEach(function (p) {
        var v = p.variants && p.variants[0];
        if (!v) return;
        if (!catalog.some(function (c) { return c.handle === p.handle; })) {
          catalog.push({ id: String(p.id), name: p.title, price: v.price, compare_at_price: v.compare_at_price || '0', handle: p.handle, image_url: (p.images && p.images[0] && p.images[0].src) || '', variant_id: v.id });
        }
      });
    }

    var pageCtx = _getPageContext();
    fetch(API_BASE + '/api/widget/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: API_KEY, message: text, history: _cncgHistory, catalog: catalog.slice(0, 30), personality: BOT_PERSONALITY, page_context: pageCtx, customer_profile: _cncgProfileSummary() })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        typing.remove();
        if (!d || d.reply === "I'm having trouble right now. Please try again!" || d.reply === "I'm having trouble right now. Try again!") {
          // LLM unavailable — fall back to local keyword search
          var local = _cncgLocalSearch(text);
          if (local.length) {
            _cncgAddBot(msgs, "Found some great options — I think these will suit you perfectly! 🛍️");
            _cncgRenderProducts(msgs, local);
          } else {
            _cncgAddBot(msgs, "Hmm, I didn't find an exact match, but let me suggest a few ways to explore — sometimes the best finds are just around the corner! 🔍");
            _cncgBackChip(msgs);
          }
          msgs.scrollTop = msgs.scrollHeight;
          return;
        }
        var reply = d.reply || "I'm here to help!";
        _cncgAddBot(msgs, reply);
        _cncgHistory.push({ role: 'assistant', content: reply });
        if (d.product_ids && d.product_ids.length) {
          var matched = catalog.filter(function (p) { return d.product_ids.indexOf(p.id) >= 0; });
          if (_cncgEl && _cncgEl._shopifyProducts) {
            matched = matched.map(function (p) {
              if (p.handle) return p;
              var resolved = _resolveProductHandle(p);
              return resolved ? Object.assign({}, p, { handle: resolved }) : p;
            });
          }
          // Exclude current product + cart items so "similar items" shows actual alternatives
          _btgvFilterShown(matched, function (filtered) {
            if (filtered.length) _cncgRenderProducts(msgs, filtered);
            msgs.scrollTop = msgs.scrollHeight;
          });
        } else {
          msgs.scrollTop = msgs.scrollHeight;
        }
      })
      .catch(function () {
        typing.remove();
        var local = _cncgLocalSearch(text);
        if (local.length) {
          _cncgAddBot(msgs, "I found some lovely options — take a look! 🛍️");
          _cncgRenderProducts(msgs, local);
        } else {
          _cncgAddBot(msgs, "I'm having a moment, but I'm back! Try asking about a specific style, price range, or occasion — I know this store inside out. 😊");
          _cncgBackChip(msgs);
        }
        msgs.scrollTop = msgs.scrollHeight;
      });
  }

  // ─── Product-page auto-inject: "Watch & Shop" shelf ──────────────────────────
  // On /products/<handle> pages, fetch videos tagged to this product and
  // inject a horizontal shelf right above the product form (cart button).
  // Zero theme edits required from the merchant. Silent no-op if no tagged
  // videos exist for this product.
  function injectProductShelf() {
    var m = window.location.pathname.match(/\/products\/([^/?#]+)/);
    if (!m) return;
    var handle = m[1];

    fetch(API_BASE + '/api/widget/videos/by-product?k=' + encodeURIComponent(API_KEY) + '&handle=' + encodeURIComponent(handle))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (videos) {
        if (!videos || !videos.length) return;
        renderProductShelf(videos);
      }).catch(function () {});
  }

  function renderProductShelf(videos) {
    // Avoid double-render on SPA-style theme navigation
    if (document.getElementById('_btgv_product_shelf')) return;

    // Find a sensible insert point — closest form ancestor of the cart button
    // is the most consistent across themes. Fall back to the cart button's
    // parent, then to body.
    var cartBtnSelectors = [
      '[data-add-to-cart]', '.btn-cart', '#add-to-cart', '[name="add"]',
      '.product-form__cart-submit', '.product-form__submit',
      '.add-to-cart-btn', '.btn-addtocart', '#AddToCart',
      '.shopify-payment-button__button',
    ];
    var cartBtn = null;
    for (var i = 0; i < cartBtnSelectors.length; i++) {
      cartBtn = document.querySelector(cartBtnSelectors[i]);
      if (cartBtn) break;
    }
    var anchor = cartBtn ? (cartBtn.closest('form') || cartBtn.parentNode) : null;
    if (!anchor || !anchor.parentNode) return;

    var host = document.createElement('div');
    host.id = '_btgv_product_shelf';
    host.style.cssText = 'margin: 16px 0; width: 100%;';
    var shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = [
      '.shelf{font-family:system-ui,-apple-system,sans-serif;}',
      '.hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}',
      '.hdr h3{margin:0;font-size:14px;font-weight:600;color:#111;letter-spacing:-.01em}',
      '.hdr .pill{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#fff;padding:3px 8px;border-radius:999px;background:linear-gradient(135deg,#FF6B35,#F72585);}',
      '.row{display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;padding:2px 2px 12px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;}',
      '.row::-webkit-scrollbar{display:none}',
      '.tile{position:relative;flex:0 0 auto;width:124px;aspect-ratio:9/16;border-radius:14px;overflow:hidden;background:#000;cursor:pointer;scroll-snap-align:start;box-shadow:0 4px 14px rgba(0,0,0,.12);transition:transform .15s ease, box-shadow .15s ease}',
      '.tile:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.18)}',
      '.tile img,.tile video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
      '.tile .play{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;font-weight:600;padding:3px 7px;border-radius:6px;backdrop-filter:blur(4px);display:flex;align-items:center;gap:3px}',
      '.tile .grad{position:absolute;inset-x:0;bottom:0;height:50%;background:linear-gradient(to top,rgba(0,0,0,.7),transparent);pointer-events:none}',
      '.tile .ttl{position:absolute;left:8px;right:8px;bottom:6px;color:#fff;font-size:11px;line-height:1.25;font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 1px 2px rgba(0,0,0,.35)}',
    ].join('');
    shadow.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'shelf';

    var hdr = document.createElement('div');
    hdr.className = 'hdr';
    hdr.innerHTML = '<h3>Watch & Shop</h3><span class="pill">' + videos.length + (videos.length === 1 ? ' video' : ' videos') + '</span>';
    wrap.appendChild(hdr);

    var row = document.createElement('div');
    row.className = 'row';
    videos.forEach(function (v, idx) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      var media = '';
      if (v.thumbnail_url) {
        media = '<img src="' + v.thumbnail_url + '" alt="" loading="lazy" />';
      } else if (v.s3_url) {
        media = '<video src="' + v.s3_url + '" muted playsinline preload="metadata"></video>';
      }
      var title = (v.title || '').replace(/[<>"']/g, '').slice(0, 80);
      tile.innerHTML = media +
        '<div class="play">▶ ' + (v.s3_url ? 'Play' : 'View') + '</div>' +
        '<div class="grad"></div>' +
        (title ? '<div class="ttl">' + title + '</div>' : '');
      tile.addEventListener('click', function () {
        // Reuse the existing feed-viewer if available, otherwise deep-link
        // to the floating launcher in feed mode.
        if (typeof openFeed === 'function' && Array.isArray(videos)) {
          try { openFeed(idx, videos); return; } catch (e) {}
        }
        // Fallback: deep-link to /preview if the dashboard is hosting it
        var url = window.location.pathname + '?btgv=' + encodeURIComponent(v.id);
        history.replaceState(null, '', url);
        window.dispatchEvent(new Event('popstate'));
      });
      row.appendChild(tile);
    });
    wrap.appendChild(row);

    shadow.appendChild(wrap);
    anchor.parentNode.insertBefore(host, anchor);
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    var path = window.location.pathname;
    // Cart page: show deal banner + confetti only
    if (path === '/cart' || path.startsWith('/cart/')) { handleCartPage(); return; }
    injectStyles();
    rtGetConfig(null); // fetch bot config (bot_name, bot_greeting) from API eagerly

    // Product page: drop a Watch & Shop shelf above the cart form. No-op
    // if not on a product page or no videos are tagged to this product.
    injectProductShelf();

    // Auto-open concierge with product-specific deal intro when landing from a card click
    (function () {
      try {
        var params = new URL(window.location.href).searchParams;
        // Slice G: proactively pre-stage the negotiation intro on EVERY
        // negotiable product page, not just when ?btg_neg=1 is set. This
        // turns the haggle into a first-class affordance for boutique
        // shoppers — the existing concierge-open flow (line ~3815) will
        // surface the product card + "Push for a better price" chip
        // automatically once _btgNegProduct is populated.
        var isPDP = window.location.pathname.indexOf('/products/') !== -1;
        var forced = params.get('btg_neg') === '1';
        if (isPDP) {
          var handle = window.location.pathname.split('/products/')[1].split('?')[0].split('#')[0];
          if (!handle) return;
          fetch('/products/' + handle + '.json')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
              if (!data || !data.product) return;
              var p = data.product;
              var v = p.variants && p.variants[0];
              if (!v) return;
              var setIt = function () {
                _btgNegProduct = {
                  shopify_product_id: String(p.id),
                  product_name: p.title,
                  price: v.price,
                  compare_at_price: v.compare_at_price || '0',
                  handle: p.handle,
                  image_url: (p.images && p.images[0] && p.images[0].src) || '',
                  variant_id: v.id,
                  tags: p.tags || [],
                };
              };
              if (forced) { setIt(); return; }
              // Gated by per-product eligibility — don't pre-stage haggle
              // intro on items the merchant has marked fixed-price.
              _btgvFetchProductRules(p.handle, p.tags || [], function (rules) {
                if (rules && rules.negotiable === false) return;
                setIt();
              });
            }).catch(function () {});
        }
      } catch (e) {}
    })();

    // Read deep-link param — open the right viewer after data loads
    var deepId = null;
    try {
      deepId = new URL(window.location.href).searchParams.get('btgv');
    } catch (e) {}

    if (EMBED_MODE) {
      // Legacy embed: inject stories bar + grid into page layout
      var storiesCont = getStoriesContainer();
      var gridCont = getGridContainer();

      fetchCollections(function (cols) {
        allCols = cols;
        if (cols.length) buildStoriesBar(storiesCont, cols);
        if (deepId && deepId.indexOf('s:') === 0) {
          var colId = deepId.slice(2);
          var col = null;
          cols.forEach(function (c) { if (String(c.id) === colId) col = c; });
          if (col) {
            fetchCollectionVideos(col.id, function (vids) {
              if (vids.length) openStoryViewer(vids, col);
            });
          }
        }
      });

      fetchAllVideos(function (vids) {
        allVideos = vids;
        var productItems = extractProductItems(vids);
        var feedItems = buildMixedFeed(vids, productItems);
        if (feedItems.length) buildGrid(gridCont, feedItems);
        if (deepId && deepId.indexOf('s:') !== 0) {
          var idx = -1;
          feedItems.forEach(function (v, i) { if (v._type !== 'product' && String(v.id) === deepId) idx = i; });
          if (idx >= 0) openFeed(idx, feedItems);
        }
      });

    } else {
      // Default: floating launcher — zero page layout changes
      var _cols = [];
      var _feedItems = [];
      var colsDone = false, vidsDone = false;

      function maybeShowLauncher() {
        if (!colsDone || !vidsDone) return;
        if (_feedItems.length) buildLauncher(_feedItems, _cols);
        // Deep link still works — open feed directly if URL has btgv param
        if (deepId && deepId.indexOf('s:') !== 0) {
          var idx = -1;
          _feedItems.forEach(function (v, i) { if (v._type !== 'product' && String(v.id) === deepId) idx = i; });
          if (idx >= 0) openFeed(idx, _feedItems);
        }
        if (deepId && deepId.indexOf('s:') === 0) {
          var colId = deepId.slice(2);
          var col = null;
          _cols.forEach(function (c) { if (String(c.id) === colId) col = c; });
          if (col) {
            fetchCollectionVideos(col.id, function (vids) {
              if (vids.length) openStoryViewer(vids, col);
            });
          }
        }
      }

      fetchCollections(function (cols) {
        allCols = cols;
        _cols = cols;
        colsDone = true;
        maybeShowLauncher();
      });

      fetchAllVideos(function (vids) {
        allVideos = vids;
        var productItems = extractProductItems(vids);
        _feedItems = buildMixedFeed(vids, productItems);
        vidsDone = true;
        maybeShowLauncher();
      });

      // Fetch all Shopify products for full store knowledge in AI chat
      fetch('/products.json?limit=150')
        .then(function (r) { return r.ok ? r.json() : { products: [] }; })
        .then(function (d) {
          if (_cncgEl) _cncgEl._shopifyProducts = d.products || [];
        }).catch(function () {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
