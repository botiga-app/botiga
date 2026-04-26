(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  var API_KEY = script.getAttribute('data-key') || '';
  var API_BASE = script.getAttribute('data-api') || 'https://botiga-api-two.vercel.app';
  var GRID_TITLE = script.hasAttribute('data-grid-title')
    ? script.getAttribute('data-grid-title')
    : 'Watch & Shop';
  var EMBED_MODE = script.getAttribute('data-layout') === 'embed';
  var SESSION_ID = 'btgv_' + Math.random().toString(36).slice(2);
  var BOT_NAME = script.getAttribute('data-bot-name') || 'Botiga';
  var BOT_SUBTITLE = script.getAttribute('data-bot-subtitle') || 'AI Shopping Assistant · Online';
  var BOT_GREETING = script.getAttribute('data-greeting') || "Hi! 👋 What can I help you find today?";
  var BOT_PERSONALITY = script.getAttribute('data-bot-personality') || 'salesy';
  var BOT_AVATAR = script.getAttribute('data-bot-avatar') || null;

  if (!API_KEY) return;

  var allVideos = [], allCols = [], likedSet = {};
  var storyEl = null, storyVideos = [], storyIdx = 0, storyAnimFrame = null;
  var feedEl = null, pollTimer = null;
  var launcherEl = null;
  var _cncgEl = null, _cncgOpen = false, _cncgHistory = [];

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
    }).then(function (r) { if (cb) cb(r.ok); }).catch(function () { if (cb) cb(false); });
  }

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
      '._btgv_gc_pb_cart{background:rgba(255,255,255,.18)}',
      '._btgv_gc_pb_buy{background:rgba(99,102,241,.8)}',
      '._btgv_gc_pb_neg{background:rgba(236,72,153,.8)}',

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
      '._btgv_rail button{background:rgba(0,0,0,.45);backdrop-filter:blur(8px);border:none;border-radius:50%;width:48px;height:48px;color:#fff;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:12px;transition:transform .15s}',
      '._btgv_rail button:active{transform:scale(.9)}',


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
      '._btgv_ib_cart{background:rgba(255,255,255,.15);color:#fff}',
      '._btgv_ib_buy{background:rgba(99,102,241,.85);color:#fff}',
      '._btgv_ib_neg{background:rgba(236,72,153,.85);color:#fff}',
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
      // Floating launcher
      '#_btgv_launcher{position:fixed;bottom:24px;right:20px;z-index:99998;display:flex;flex-direction:row-reverse;align-items:flex-end;gap:8px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '._btgv_lstack{display:flex;align-items:flex-end}',
      '._btgv_lring{border-radius:50%;background:linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%);flex-shrink:0}',
      '._btgv_lring_main{width:60px;height:60px;padding:3px;animation:_btgv_lpulse 2s ease-in-out infinite}',
      '._btgv_lring_mid{width:44px;height:44px;padding:2.5px;margin-left:-14px;animation:_btgv_lpulse 2s ease-in-out infinite;animation-delay:.35s}',
      '._btgv_lring_sm{width:34px;height:34px;padding:2px;margin-left:-12px;animation:_btgv_lpulse 2s ease-in-out infinite;animation-delay:.7s}',
      '._btgv_lring_inner{width:100%;height:100%;border-radius:50%;background:#111;border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;overflow:hidden}',
      '._btgv_lring_inner video,._btgv_lring_inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}',
      '._btgv_lring_inner span{font-size:22px;line-height:1}',
      '._btgv_lring_mid ._btgv_lring_inner{border-width:2px}',
      '._btgv_lring_sm ._btgv_lring_inner{border-width:1.5px}',
      '._btgv_llabel{background:#111;color:#fff;font-size:11px;font-weight:700;letter-spacing:.3px;padding:6px 12px;border-radius:99px;white-space:nowrap;margin-bottom:10px;box-shadow:0 2px 10px rgba(0,0,0,.3);user-select:none}',
      '@keyframes _btgv_lpulse{0%,100%{box-shadow:0 0 0 0 rgba(220,39,67,.5),0 4px 14px rgba(220,39,67,.3)}50%{box-shadow:0 0 0 10px rgba(220,39,67,.0),0 4px 22px rgba(220,39,67,.55)}}',
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
      '._btgv_pbtn_cart{background:rgba(255,255,255,.18);color:#fff;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.25)}',
      '._btgv_pbtn_buy{background:rgba(99,102,241,.9);color:#fff}',
      '._btgv_pbtn_neg{background:rgba(236,72,153,.9);color:#fff}',

      // ─── Concierge chat ───────────────────────────────────────────────────────
      '#_btgv_cncg{position:fixed;bottom:90px;right:20px;z-index:99997;width:390px;background:#0c0c14;border-radius:20px;border:1px solid rgba(255,255,255,.06);box-shadow:0 24px 60px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.04);font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;overflow:hidden;transform:translateY(20px) scale(0.96);opacity:0;pointer-events:none;transition:transform .3s cubic-bezier(.34,1.56,.64,1),opacity .22s ease}',
      '#_btgv_cncg.open{transform:translateY(0) scale(1);opacity:1;pointer-events:all}',
      '@media(max-width:440px){#_btgv_cncg{width:calc(100vw - 16px);right:8px;bottom:72px;border-radius:16px}}',
      '@media(max-width:440px){._btgv_cncg_msgs{max-height:calc(100svh - 240px);min-height:220px}}',
      // shimmer
      '._btgv_cncg_shim{height:3px;background:linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899,#f59e0b,#6366f1);background-size:200% 100%;animation:_btgv_cncg_shim 2.5s linear infinite;flex-shrink:0}',
      '@keyframes _btgv_cncg_shim{0%{background-position:0% 0%}100%{background-position:200% 0%}}',
      // header
      '._btgv_cncg_hdr{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0}',
      '._btgv_cncg_av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#ec4899);display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;flex-shrink:0;position:relative;overflow:hidden}',
      '._btgv_cncg_av img{width:100%;height:100%;object-fit:cover;border-radius:50%}',
      '._btgv_cncg_dot{position:absolute;bottom:0;right:0;width:9px;height:9px;background:#22c55e;border-radius:50%;border:2px solid #0c0c14;animation:_btgv_cncg_pulse 2s ease-in-out infinite}',
      '@keyframes _btgv_cncg_pulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.45)}50%{box-shadow:0 0 0 4px rgba(34,197,94,0)}}',
      '._btgv_cncg_namecol{flex:1;min-width:0}',
      '._btgv_cncg_title{color:#fff;font-size:13px;font-weight:700}',
      '._btgv_cncg_sub{color:rgba(255,255,255,.38);font-size:10px;margin-top:1px}',
      '._btgv_cncg_x{width:26px;height:26px;border:none;background:rgba(255,255,255,.07);border-radius:50%;color:rgba(255,255,255,.45);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}',
      // messages area
      '._btgv_cncg_msgs{flex:1;overflow-y:auto;overflow-x:hidden;padding:14px 12px 8px;display:flex;flex-direction:column;gap:9px;min-height:260px;max-height:460px;scrollbar-width:none}',
      '._btgv_cncg_msgs::-webkit-scrollbar{display:none}',
      // bubbles
      '._btgv_cncg_bot{align-self:flex-start;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);color:#fff;font-size:13px;line-height:1.55;padding:10px 13px;border-radius:16px 16px 16px 4px;max-width:88%}',
      '._btgv_cncg_usr{align-self:flex-end;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:13px;line-height:1.55;padding:10px 13px;border-radius:16px 16px 4px 16px;max-width:88%}',
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
      // video carousel (inline in chat)
      '._btgv_cncg_vcarousel{display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;padding:2px 2px 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory}',
      '._btgv_cncg_vcarousel::-webkit-scrollbar{display:none}',
      '._btgv_cncg_vtile{flex-shrink:0;width:140px;height:220px;border-radius:14px;overflow:hidden;position:relative;cursor:pointer;background:#111;-webkit-tap-highlight-color:transparent;transition:transform .15s;scroll-snap-align:start}',
      '._btgv_cncg_vtile:active{transform:scale(.97)}',
      '._btgv_cncg_vtile video,._btgv_cncg_vtile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
      '._btgv_cncg_vtile_ov{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.82) 0%,rgba(0,0,0,.1) 50%,transparent 100%)}',
      '._btgv_cncg_vtile_foot{position:absolute;bottom:0;left:0;right:0;padding:10px 9px;display:flex;flex-direction:column;gap:6px}',
      '._btgv_cncg_vtile_title{color:#fff;font-size:11px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '._btgv_cncg_vtile_watch{background:rgba(255,255,255,.18);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.25);color:#fff;font-size:10px;font-weight:700;padding:5px 10px;border-radius:99px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;text-align:center;letter-spacing:.3px}',
      '._btgv_cncg_vtile_title{position:absolute;bottom:0;left:0;right:0;padding:4px 6px;color:#fff;font-size:9px;font-weight:600;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // product card carousel — portrait cards, scroll-snap, arrow nav
      '._btgv_cncg_pcardsw{position:relative;width:100%;padding:0 4px;box-sizing:border-box}',
      '._btgv_cncg_pcards{display:flex;gap:10px;overflow-x:auto;overflow-y:visible;padding:4px 4px 12px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;width:100%;box-sizing:border-box}',
      '._btgv_cncg_pcards::-webkit-scrollbar{display:none}',
      '._btgv_cncg_pcard{flex-shrink:0;width:calc(100% - 44px);background:#fff;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;scroll-snap-align:start;box-shadow:0 4px 16px rgba(0,0,0,.22);position:relative;cursor:pointer}',
      '._btgv_cncg_pcard_img{width:100%;height:220px;object-fit:cover;object-position:50% 20%;display:block;background:#f3f4f6;flex-shrink:0}',
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
      '._btgv_cncg_send{width:34px;height:34px;border:none;border-radius:50%;background:linear-gradient(135deg,#6366f1,#ec4899);color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s}',
      '._btgv_cncg_send:disabled{opacity:.35;cursor:default}',
    ].join('');
    document.head.appendChild(s);
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
        addToCart(tag.shopify_variant_id, function (ok) {
          fireConfetti();
          if (ok) {
            btn.innerHTML = '<span style="font-size:16px">✓</span><span class="_btgv_icon_lbl">Added</span>';
            setTimeout(function () { btn.innerHTML = '<span style="font-size:16px">🛒</span><span class="_btgv_icon_lbl">Cart</span>'; }, 2500);
          }
        });
      }));
      actions.appendChild(iconBtn('_btgv_ib_buy', '⚡', 'Buy', function () {
        track(videoId, 'add_to_cart', tag.shopify_product_id);
        addToCart(tag.shopify_variant_id, function (ok) {
          if (ok) { fireConfetti(); window.location.href = '/checkout'; }
        });
      }));
      actions.appendChild(iconBtn('_btgv_ib_neg', '🤝', 'Negotiate', function () {
        track(videoId, 'negotiate', tag.shopify_product_id);
        openNegotiateModal(tag);
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
          counterBtn.addEventListener('click', function () { chips.remove(); inp.focus(); });
          chips.appendChild(counterBtn); chips.appendChild(acceptBtn);
          msgsEl.appendChild(chips);
        }
      }

      msgsEl.scrollTop = msgsEl.scrollHeight;
      return m;
    }

    function showGate(d) {
      removeTyping();
      var g = document.createElement('div'); g.className = 'msg bot';
      var blurred = d.bot_reply.replace(/\$[\d,]+(?:\.\d{1,2})?/g, function (m) {
        return '<span class="_btg_p" style="filter:blur(2px);transition:filter 0.8s ease;display:inline-block;user-select:none">' + m + '</span>';
      });
      g.innerHTML =
        '<div style="font-size:11px;font-weight:600;color:#6366f1;letter-spacing:0.03em;margin-bottom:8px">🔒 I found a private price on this</div>' +
        '<div style="line-height:1.6;margin-bottom:14px">' + blurred + '</div>' +
        '<form id="_btg_f" style="display:flex;gap:6px;margin-bottom:6px">' +
          '<input id="_btg_e" type="email" placeholder="Email me my private price" autocomplete="email"' +
          ' style="flex:1;min-width:0;border:1.5px solid #e5e5e5;border-radius:8px;padding:8px 10px;font-size:12px;outline:none;font-family:inherit" />' +
          '<button type="submit" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Unlock →</button>' +
        '</form>' +
        '<div style="text-align:center;font-size:10px;color:#bbb;margin:6px 0">— or —</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:6px">' +
          '<input id="_btg_w" type="tel" placeholder="WhatsApp number" autocomplete="tel"' +
          ' style="flex:1;min-width:0;border:1.5px solid #e5e5e5;border-radius:8px;padding:8px 10px;font-size:12px;outline:none;font-family:inherit" />' +
          '<button type="button" id="_btg_ws" style="background:#25D366;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Send →</button>' +
        '</div>' +
        '<div style="font-size:10px;color:#ccc">No spam. Just your deal.</div>';
      msgsEl.appendChild(g); msgsEl.scrollTop = msgsEl.scrollHeight;

      setLoading(false); sendBtn.disabled = true; inp.disabled = true;
      requestAnimationFrame(function () {
        var emailInp = shadow.querySelector('#_btg_e');
        if (emailInp) emailInp.focus();
      });

      function doUnlock(contactPayload, triggerEl) {
        if (triggerEl) { triggerEl.disabled = true; triggerEl.textContent = '...'; }
        fetch(API_BASE + '/api/negotiate/' + negId + '/contact', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(contactPayload)
        }).then(function () {
          shadow.querySelectorAll('._btg_p').forEach(function (el) { el.style.filter = 'blur(0px)'; });
          setTimeout(function () {
            g.remove();
            appendMsg('bot', d.bot_reply);
            setLoading(false); sendBtn.disabled = false; inp.disabled = false;
            setTimeout(function () { inp.focus(); }, 80);
          }, 900);
        }).catch(function () {
          shadow.querySelectorAll('._btg_p').forEach(function (el) { el.style.filter = 'blur(0px)'; });
          setTimeout(function () {
            g.remove();
            appendMsg('bot', d.bot_reply);
            setLoading(false); sendBtn.disabled = false; inp.disabled = false;
          }, 900);
        });
      }

      shadow.querySelector('#_btg_f').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var em = shadow.querySelector('#_btg_e').value.trim();
        if (!em || em.indexOf('@') < 0) return;
        doUnlock({ email: em }, shadow.querySelector('#_btg_f button[type=submit]'));
      });

      shadow.querySelector('#_btg_ws').addEventListener('click', function () {
        var ph = shadow.querySelector('#_btg_w').value.trim();
        if (!ph) { shadow.querySelector('#_btg_w').focus(); return; }
        doUnlock({ phone: ph }, this);
      });
    }

    function showDeal(dealPrice, checkoutUrl, discountCode) {
      if (dealShown) return; dealShown = true;
      var inputRowEl = shadow.querySelector('#input-row'); if (inputRowEl) inputRowEl.remove();
      var saved = Math.round(listPrice - dealPrice);
      var savedPct = Math.round((saved / listPrice) * 100);

      // Brief celebration screen — auto-redirects to cart, no button needed
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
        '<div class="deal-savings" id="_ds show">' + (saved > 0 ? 'You saved $' + saved + ' · ' + savedPct + '% off' : 'Deal locked in') + '</div>' +
        '<div class="deal-redirect-msg" id="_drm" style="font-size:13px;color:#888;margin-top:18px">Taking you to cart...</div>';
      panel.appendChild(ds);
      requestAnimationFrame(function () { ds.classList.add('visible'); });

      // Animate savings badge in immediately
      setTimeout(function () {
        var badge = shadow.querySelector('#_ds'); if (badge) badge.classList.add('show');
      }, 300);

      // Add to cart then redirect — 2.2s gives the animation time to land
      addToCart(tag.shopify_variant_id, function () {
        var dest = discountCode ? '/cart?discount=' + encodeURIComponent(discountCode) : '/cart';
        setTimeout(function () { window.location.href = dest; }, 2200);
      });
    }

    function doNegotiate(customerMsg) {
      var body = {
        api_key: API_KEY, session_id: SESSION_ID,
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
            if (d.status === 'won' && d.deal_price) {
              // Save to _botiga_session deals array (multiple deals supported)
              try {
                var raw = sessionStorage.getItem('_botiga_session');
                var sess = raw ? JSON.parse(raw) : {};
                var newDeal = {
                  price: d.deal_price,
                  checkoutUrl: d.checkout_url,
                  expiresAt: d.expires_at || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
                  displayExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                  discountCode: d.discount_code || null,
                  productName: tag.product_name || ''
                };
                var deals = sess.deals || (sess.deal ? [sess.deal] : []);
                var idx = -1;
                deals.forEach(function (x, i) { if (x.productName === newDeal.productName) idx = i; });
                if (idx >= 0) deals[idx] = newDeal; else deals.push(newDeal);
                sess.deals = deals;
                sess.ts = Date.now();
                sessionStorage.setItem('_botiga_session', JSON.stringify(sess));
              } catch (e) {}
              try { document.dispatchEvent(new CustomEvent('botiga:deal', { detail: { price: d.deal_price } })); } catch (e) {}
              showDeal(d.deal_price, d.checkout_url, d.discount_code);
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

  function buildProductSlide(tag) {
    var slide = document.createElement('div');
    slide.className = '_btgv_slide';
    slide.style.background = '#111';

    if (tag.image_url) {
      var bg = document.createElement('img');
      bg.className = '_btgv_pslide_img'; bg.src = tag.image_url; bg.alt = '';
      slide.appendChild(bg);
    }
    var grad = document.createElement('div'); grad.className = '_btgv_grad'; slide.appendChild(grad);

    var panel = document.createElement('div'); panel.className = '_btgv_ppanel';

    var badge = document.createElement('div'); badge.className = '_btgv_pbadge'; badge.textContent = '✨ Shop Now';
    panel.appendChild(badge);

    var nm = document.createElement('div'); nm.className = '_btgv_pname'; nm.textContent = tag.product_name || '';
    panel.appendChild(nm);

    var price = parseFloat(tag.price || 0);
    var was = parseFloat(tag.compare_at_price || 0);
    var prRow = document.createElement('div'); prRow.className = '_btgv_pprrow';
    if (price > 0) {
      var ps = document.createElement('div'); ps.className = '_btgv_pprice'; ps.textContent = '$' + price.toFixed(2);
      prRow.appendChild(ps);
      if (was > price) {
        var ws = document.createElement('div'); ws.className = '_btgv_pwas'; ws.textContent = '$' + was.toFixed(2);
        var ds = document.createElement('div'); ds.className = '_btgv_pdiscbadge'; ds.textContent = Math.round((1 - price / was) * 100) + '% off';
        prRow.appendChild(ws); prRow.appendChild(ds);
      }
    }
    panel.appendChild(prRow);

    var acts = document.createElement('div'); acts.className = '_btgv_pacts';
    function pbtn(cls, icon, lbl, fn) {
      var btn = document.createElement('button');
      btn.className = '_btgv_pbtn ' + cls;
      btn.innerHTML = '<span style="font-size:18px">' + icon + '</span><span>' + lbl + '</span>';
      btn.onclick = function (e) { e.stopPropagation(); fn(btn); };
      return btn;
    }
    acts.appendChild(pbtn('_btgv_pbtn_cart', '🛒', 'Cart', function (btn) {
      track(tag._videoId || '', 'add_to_cart', tag.shopify_product_id);
      addToCart(tag.shopify_variant_id, function (ok) {
        fireConfetti();
        if (ok) { btn.querySelector('span:last-child').textContent = 'Added!'; setTimeout(function () { btn.querySelector('span:last-child').textContent = 'Cart'; }, 2500); }
      });
    }));
    acts.appendChild(pbtn('_btgv_pbtn_buy', '⚡', 'Buy Now', function () {
      track(tag._videoId || '', 'add_to_cart', tag.shopify_product_id);
      addToCart(tag.shopify_variant_id, function (ok) { if (ok) { fireConfetti(); window.location.href = '/checkout'; } });
    }));
    acts.appendChild(pbtn('_btgv_pbtn_neg', '🤝', 'Negotiate', function () {
      track(tag._videoId || '', 'negotiate', tag.shopify_product_id);
      openNegotiateModal(tag);
    }));
    panel.appendChild(acts);
    slide.appendChild(panel);
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
        var video = document.createElement('video');
        video.dataset.src = item.s3_url;
        video.muted = true; video.loop = true;
        video.playsInline = true; video.preload = 'none';
        cell.appendChild(video);
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
          openNegotiateModal(tag);
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

    var muted = false;
    var muteBtn = document.createElement('button');
    muteBtn.id = '_btgv_mute'; muteBtn.textContent = '🔊';
    muteBtn.onclick = function () {
      muted = !muted;
      muteBtn.textContent = muted ? '🔇' : '🔊';
      feedEl.querySelectorAll('._btgv_slide video').forEach(function (v) { v.muted = muted; });
    };
    feedEl.appendChild(muteBtn);

    var scroll = document.createElement('div');
    scroll.id = '_btgv_scroll';
    feedEl.appendChild(scroll);

    vids.forEach(function (item, i) {
      // Product card slide
      if (item._type === 'product') {
        scroll.appendChild(buildProductSlide(item));
        return;
      }

      // Video slide
      var vid = item;
      var slide = document.createElement('div');
      slide.className = '_btgv_slide';

      var video = document.createElement('video');
      video.dataset.src = vid.s3_url;
      video.muted = muted; video.loop = false;
      video.playsInline = true; video.preload = 'none';
      video.onended = function () {
        var next = scroll.children[i + 1];
        if (next) next.scrollIntoView({ behavior: 'smooth' });
        else closeFeed();
      };

      var grad = document.createElement('div'); grad.className = '_btgv_grad';

      var rail = document.createElement('div'); rail.className = '_btgv_rail';
      var likeCount = vid.likes_count || 0;
      var likeBtn = document.createElement('button');
      likeBtn.innerHTML = '<span style="font-size:22px">🤍</span><span>' + fmtCount(likeCount) + '</span>';
      likeBtn.onclick = function (e) {
        e.stopPropagation();
        if (!likedSet[vid.id]) {
          likedSet[vid.id] = true;
          likeBtn.querySelectorAll('span')[0].textContent = '❤️';
          likeCount++;
          likeBtn.querySelectorAll('span')[1].textContent = fmtCount(likeCount);
          track(vid.id, 'like');
        }
      };
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
      rail.appendChild(likeBtn); rail.appendChild(cmtBtn); rail.appendChild(shareBtn);

      // View count — top-right pill like Facebook
      var viewsEl = document.createElement('div');
      viewsEl.className = '_btgv_views';
      var _vc = vid.views_count || 0;
      viewsEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><span>' + fmtCount(_vc) + '</span>';

      slide._btgv_likeBtn = likeBtn;
      slide.appendChild(video); slide.appendChild(grad); slide.appendChild(viewsEl); slide.appendChild(rail);
      var tags = vid.video_product_tags || [];
      if (tags.length) slide.appendChild(buildProductShelf(tags, vid.id));

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
          // Update like count — spawn hearts + pop animation if increased
          var likeSpan = slideEl.querySelector('._btgv_rail button:first-child span:last-child');
          if (likeSpan && d.likes_count != null) {
            var prevLikes = item._polledLikes;
            if (prevLikes != null && d.likes_count > prevLikes) {
              spawnHeart();
              likeSpan.style.transition = 'transform .15s ease';
              likeSpan.style.transform = 'scale(1.4)';
              setTimeout(function () { likeSpan.style.transform = 'scale(1)'; }, 200);
            }
            item._polledLikes = d.likes_count;
            likeSpan.textContent = fmtCount(d.likes_count);
          }
          // Update comment button count
          var cmtSpan = slideEl.querySelector('._btgv_rail button:nth-child(2) span:last-child');
          if (cmtSpan && d.comments_count != null) { cmtSpan.textContent = fmtCount(d.comments_count); }
        })
        .catch(function () {});
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var idx = Array.from(scroll.children).indexOf(entry.target);
        var item = idx >= 0 ? vids[idx] : null;
        var v = entry.target.querySelector('video');
        if (entry.isIntersecting) {
          if (v) {
            if (v.dataset.src && !v.src) { v.src = v.dataset.src; }
            v.play().catch(function () {});
          }
          if (item && item._type !== 'product') {
            pushDeepLink(item.id);
            track(item.id, 'view');
            // Update view badge immediately (optimistic)
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
    feedEl.classList.remove('open');
    feedEl.querySelectorAll('video').forEach(function (v) { v.pause(); v.src = ''; });
    setTimeout(function () { if (feedEl) { feedEl.remove(); feedEl = null; } }, 280);
  }

  // ─── Cart deal banner + confetti ────────────────────────────────────────────
  function handleCartPage() {
    var deals;
    try {
      var raw = sessionStorage.getItem('_botiga_session');
      if (!raw) return;
      var sess = JSON.parse(raw);
      // Support both new (deals array) and legacy (deal object) formats
      deals = sess.deals || (sess.deal ? [sess.deal] : []);
      deals = deals.filter(function (d) {
        return d && d.price && d.checkoutUrl &&
          (!d.expiresAt || Date.now() < new Date(d.expiresAt).getTime());
      });
      if (!deals.length) return;
    } catch (e) { return; }

    setTimeout(fireConfetti, 400);

    // Render one banner per active deal, stacked from top
    var totalOffset = parseInt(document.body.style.paddingTop || '0');
    deals.forEach(function (deal) {
      var banner = document.createElement('div');
      banner.className = '_btgv_deal_banner';
      banner.style.cssText = [
        'position:fixed;left:0;right:0;z-index:2147483645;',
        'background:#111;color:#fff;font-family:system-ui,sans-serif;',
        'padding:11px 20px;display:flex;align-items:center;justify-content:center;',
        'gap:12px;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,.3);flex-wrap:wrap;',
        'top:' + totalOffset + 'px;'
      ].join('');

      var textEl = document.createElement('span');
      textEl.innerHTML = '🎁 Deal on <strong>' + (deal.productName || 'this item') +
        '</strong> — <strong>$' + deal.price + '</strong>' +
        (deal.discountCode
          ? ' &middot; <code style="background:#222;padding:2px 6px;border-radius:4px;font-size:11px">' + deal.discountCode + '</code>'
          : '');

      var timerEl = document.createElement('span');
      timerEl.style.cssText = 'font-weight:700;font-variant-numeric:tabular-nums;color:#fbbf24;min-width:44px;';

      var closeBtn = document.createElement('button');
      closeBtn.style.cssText = 'background:none;border:none;color:#666;font-size:18px;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;';
      closeBtn.innerHTML = '&times;';

      banner.appendChild(textEl);
      banner.appendChild(timerEl);
      if (deal.checkoutUrl) {
        var chkBtn = document.createElement('a');
        chkBtn.href = deal.checkoutUrl;
        chkBtn.style.cssText = 'background:#16a34a;color:#fff;padding:7px 14px;border-radius:8px;font-weight:600;font-size:13px;text-decoration:none;white-space:nowrap;flex-shrink:0;';
        chkBtn.textContent = 'Checkout →';
        banner.appendChild(chkBtn);
      }
      banner.appendChild(closeBtn);
      document.body.prepend(banner);

      var bannerH = banner.offsetHeight || 46;
      totalOffset += bannerH;
      document.body.style.paddingTop = totalOffset + 'px';

      closeBtn.onclick = (function (b, h) {
        return function () {
          document.body.style.paddingTop = Math.max(0, parseInt(document.body.style.paddingTop || '0') - h) + 'px';
          b.remove();
        };
      })(banner, bannerH);

      var displayExp = deal.displayExpiresAt ? new Date(deal.displayExpiresAt) : new Date(Date.now() + 15 * 60 * 1000);
      var tick = setInterval(function () {
        var remaining = Math.max(0, displayExp - Date.now());
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
    });
  }

  // ─── Floating launcher ───────────────────────────────────────────────────────
  function buildLauncher(feedItems, cols) {
    if (launcherEl) return;
    launcherEl = document.createElement('div');
    launcherEl.id = '_btgv_launcher';

    var stack = document.createElement('div');
    stack.className = '_btgv_lstack';

    function makeRing(cls, previewSrc) {
      var ring = document.createElement('div');
      ring.className = '_btgv_lring ' + cls;
      var inner = document.createElement('div');
      inner.className = '_btgv_lring_inner';
      if (previewSrc) {
        var img = document.createElement('img');
        img.src = previewSrc;
        img.alt = '';
        inner.appendChild(img);
      } else {
        var icon = document.createElement('span');
        icon.textContent = '▶';
        inner.appendChild(icon);
      }
      ring.appendChild(inner);
      return ring;
    }

    // Pull thumbnail URLs from first 3 videos that have one
    var thumbs = [];
    feedItems.forEach(function (v) {
      if (v._type !== 'product' && v.thumbnail_url && thumbs.length < 3) thumbs.push(v.thumbnail_url);
    });
    // Fallback: use collection thumbnails
    if (thumbs.length < 3) {
      cols.forEach(function (c) {
        if (c.thumbnail_url && thumbs.length < 3) thumbs.push(c.thumbnail_url);
      });
    }

    stack.appendChild(makeRing('_btgv_lring_sm', thumbs[2] || null));
    stack.appendChild(makeRing('_btgv_lring_mid', thumbs[1] || null));
    stack.appendChild(makeRing('_btgv_lring_main', thumbs[0] || null));

    var label = document.createElement('div');
    label.className = '_btgv_llabel';
    label.textContent = 'Watch & Shop';

    launcherEl.appendChild(stack);
    launcherEl.appendChild(label);

    launcherEl.onclick = function () {
      if (_cncgOpen) { closeConcierge(); } else { openConcierge(); }
    };

    document.body.appendChild(launcherEl);
    buildConcierge(feedItems, cols);
  }

  // ─── Concierge chat ──────────────────────────────────────────────────────────
  function buildConcierge(feedItems, cols) {
    if (_cncgEl) return;
    _cncgEl = document.createElement('div');
    _cncgEl.id = '_btgv_cncg';
    _cncgEl._feedItems = feedItems;
    _cncgEl._cols = cols || [];

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
    var xBtn = document.createElement('button'); xBtn.className = '_btgv_cncg_x'; xBtn.innerHTML = '&#x2715;';
    xBtn.onclick = function (e) { e.stopPropagation(); closeConcierge(); };
    hdr.appendChild(av); hdr.appendChild(nc); hdr.appendChild(menuBtn); hdr.appendChild(xBtn);
    _cncgEl.appendChild(hdr);

    // Nav menu panel (hidden by default, overlays msgs)
    var menuPanel = document.createElement('div'); menuPanel.className = '_btgv_cncg_menupanel';
    var menuItems = [
      { icon: '🔄', label: 'New conversation', fn: function () { _cncgEl._msgs.innerHTML = ''; _cncgHistory = []; _cncgEl._greeted = false; _cncgToggleMenu(); openConcierge(); } },
      { icon: '⭐', label: "What's recommended?", fn: function () { _cncgToggleMenu(); _cncgAddUser(_cncgEl._msgs, "What's recommended?"); _cncgSend("What's recommended?", _cncgEl._msgs, _cncgEl._inp, _cncgEl._sendBtn); } },
      { icon: '📦', label: 'Track my order', fn: function () { _cncgToggleMenu(); _cncgTrackOrder(_cncgEl._msgs); } },
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
  }

  function openConcierge() {
    if (!_cncgEl) return;
    _cncgOpen = true;
    requestAnimationFrame(function () { _cncgEl.classList.add('open'); });
    if (!_cncgEl._greeted) {
      _cncgEl._greeted = true;
      var msgs = _cncgEl._msgs;
      setTimeout(function () {
        _cncgAddBot(msgs, BOT_GREETING);
        _cncgMainMenu(msgs);
      }, 200);
    }
  }

  function closeConcierge() {
    if (!_cncgEl) return;
    _cncgOpen = false;
    _cncgEl.classList.remove('open');
  }

  // ── Nav menu toggle ──────────────────────────────────────────────────────────
  function _cncgToggleMenu() {
    if (!_cncgEl || !_cncgEl._menuPanel) return;
    _cncgEl._menuPanel.classList.toggle('open');
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
      nm.textContent = p.product_name || p.title || '';
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

      // Card tap → open product page
      var handle = p.handle || '';
      (function (h) {
        if (h) card.onclick = function (e) { if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return; window.open('/products/' + h, '_blank'); };
      })(handle);

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

      // Row 2: Make an offer (full width)
      var negBtn = document.createElement('button'); negBtn.className = '_btgv_cncg_pcard_neg'; negBtn.textContent = '🤝 Make an offer';
      negBtn.onclick = function (e) { e.stopPropagation(); closeConcierge(); openNegotiateModal(p); };
      btns.appendChild(negBtn);

      body.appendChild(nm); body.appendChild(pr); body.appendChild(btns);
      card.appendChild(body);
      wrap.appendChild(card);
    });

    // Wrap carousel in a positioned container with prev/next arrows
    var wrapW = document.createElement('div'); wrapW.className = '_btgv_cncg_pcardsw';
    wrapW.appendChild(wrap);
    var cardStep = 230; // 220px card + 10px gap
    var prevBtn = document.createElement('button'); prevBtn.className = '_btgv_cncg_pscrl _btgv_cncg_pscrl_l';
    prevBtn.innerHTML = '&#8249;'; prevBtn.style.display = 'none';
    prevBtn.onclick = function (e) { e.stopPropagation(); wrap.scrollBy({ left: -cardStep, behavior: 'smooth' }); };
    var nextBtn = document.createElement('button'); nextBtn.className = '_btgv_cncg_pscrl _btgv_cncg_pscrl_r';
    nextBtn.innerHTML = '&#8250;';
    nextBtn.onclick = function (e) { e.stopPropagation(); wrap.scrollBy({ left: cardStep, behavior: 'smooth' }); };
    wrap.addEventListener('scroll', function () {
      prevBtn.style.display = wrap.scrollLeft > 10 ? 'flex' : 'none';
      nextBtn.style.display = (wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 10) ? 'flex' : 'none';
    });
    // hide next arrow if only 1 card
    if (products.length <= 1) nextBtn.style.display = 'none';
    wrapW.appendChild(prevBtn); wrapW.appendChild(nextBtn);
    msgs.appendChild(wrapW);

    // Suggestion chips below the carousel
    var firstP = products[0];
    if (firstP) {
      var chipWrap = document.createElement('div'); chipWrap.className = '_btgv_cncg_chips';
      var chips = [
        { label: '🛒 Add to cart', fn: function () {
          var vid = firstP.shopify_variant_id || firstP.variant_id;
          if (!vid) return;
          addToCart(vid, function (ok) { if (ok) { fireConfetti(); _cncgAddBot(msgs, '✓ Added to cart! Ready to checkout?'); _cncgBackChip(msgs); } });
        }},
        { label: '⚡ Buy Now', fn: function () {
          var vid = firstP.shopify_variant_id || firstP.variant_id;
          if (!vid) return;
          addToCart(vid, function (ok) { if (ok) { closeConcierge(); window.location.href = '/checkout'; } });
        }},
        { label: '🤝 Make an offer', fn: function () { closeConcierge(); openNegotiateModal(firstP); }}
      ];
      chips.forEach(function (c) {
        var ch = document.createElement('button'); ch.className = '_btgv_cncg_chip'; ch.textContent = c.label;
        ch.onclick = function (e) { e.stopPropagation(); c.fn(); };
        chipWrap.appendChild(ch);
      });
      msgs.appendChild(chipWrap);
    }

    _cncgBackChip(msgs);
    msgs.scrollTop = msgs.scrollHeight;
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

  // ── Main menu chips ─────────────────────────────────────────────────────────
  function _cncgMainMenu(msgs) {
    _cncgAddChips(msgs, [
      { label: '🎬 Watch & Shop', fn: function () { _cncgWatchShop(msgs); } },
      { label: '🤝 I want a deal', fn: function () { _cncgDeals(msgs); } },
      { label: '🗂 Browse Collections', fn: function () { _cncgBrowse(msgs); } },
      { label: '🔍 Help me find...', fn: function () { _cncgFind(msgs); } },
    ]);
  }

  function _cncgBackChip(msgs) {
    _cncgAddChips(msgs, [
      { label: '🏠 Main menu', fn: function () { _cncgAddBot(msgs, 'What else can I help with? 😊'); _cncgMainMenu(msgs); } },
    ]);
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
    var videos = feedItems.filter(function (v) { return v._type !== 'product' && v.s3_url; }).slice(0, 10);
    var typing = _cncgTyping(msgs);
    setTimeout(function () {
      typing.remove();
      if (!videos.length) {
        _cncgAddBot(msgs, "No videos uploaded yet. Check back soon! 🎬");
        _cncgBackChip(msgs); return;
      }
      _cncgAddBot(msgs, "Here's what's trending right now 🔥 Tap to watch!");
      var carousel = document.createElement('div'); carousel.className = '_btgv_cncg_vcarousel';
      videos.forEach(function (v) {
        var vIdx = feedItems.indexOf(v);
        var tile = document.createElement('div'); tile.className = '_btgv_cncg_vtile';
        // Thumbnail first, then swap to video on hover/tap
        if (v.thumbnail_url) {
          var thumb = document.createElement('img'); thumb.src = v.thumbnail_url; thumb.alt = '';
          tile.appendChild(thumb);
        }
        var vid = document.createElement('video');
        vid.src = v.s3_url; vid.muted = true; vid.loop = true; vid.playsInline = true;
        vid.style.opacity = '0'; vid.style.transition = 'opacity .2s';
        tile.appendChild(vid);
        tile.addEventListener('mouseenter', function () { vid.play().catch(function () {}); vid.style.opacity = '1'; });
        tile.addEventListener('mouseleave', function () { vid.pause(); vid.currentTime = 0; vid.style.opacity = '0'; });
        var ov = document.createElement('div'); ov.className = '_btgv_cncg_vtile_ov';
        tile.appendChild(ov);
        var foot = document.createElement('div'); foot.className = '_btgv_cncg_vtile_foot';
        if (v.title) { var tl = document.createElement('div'); tl.className = '_btgv_cncg_vtile_title'; tl.textContent = v.title; foot.appendChild(tl); }
        var watchBtn = document.createElement('button'); watchBtn.className = '_btgv_cncg_vtile_watch'; watchBtn.textContent = '▶ Watch';
        watchBtn.onclick = function (e) { e.stopPropagation(); closeConcierge(); openFeed(vIdx >= 0 ? vIdx : 0, feedItems); };
        foot.appendChild(watchBtn); tile.appendChild(foot);
        tile.onclick = function () { closeConcierge(); openFeed(vIdx >= 0 ? vIdx : 0, feedItems); };
        carousel.appendChild(tile);
      });
      msgs.appendChild(carousel);
      _cncgAddChips(msgs, [
        { label: '▶ Watch all ' + videos.length + ' videos', fn: function () { closeConcierge(); openFeed(0, feedItems); } },
        { label: '🏠 Main menu', fn: function () { _cncgAddBot(msgs, 'What else can I help with? 😊'); _cncgMainMenu(msgs); } },
      ]);
      msgs.scrollTop = msgs.scrollHeight;
    }, 550);
  }

  // ── Deals — product cards with Add to Cart + Negotiate ──────────────────────
  function _cncgDeals(msgs) {
    var feedItems = _cncgEl._feedItems || [];
    var products = [];
    feedItems.forEach(function (v) {
      if (v._type !== 'product' && v.video_product_tags) {
        v.video_product_tags.forEach(function (t) {
          if (!products.some(function (p) { return p.shopify_product_id === t.shopify_product_id; })) products.push(t);
        });
      }
    });
    var typing = _cncgTyping(msgs);
    setTimeout(function () {
      typing.remove();
      if (!products.length) {
        _cncgAddBot(msgs, "No products tagged yet. Browse videos to discover items! 🎬");
        _cncgAddChips(msgs, [
          { label: '🎬 Watch & Shop', fn: function () { _cncgWatchShop(msgs); } },
          { label: '🏠 Main menu', fn: function () { _cncgAddBot(msgs, 'What else can I help with? 😊'); _cncgMainMenu(msgs); } },
        ]);
        return;
      }
      // Discounted products first
      products.sort(function (a, b) {
        var da = parseFloat(a.compare_at_price || 0) > parseFloat(a.price || 0) ? 1 : 0;
        var db = parseFloat(b.compare_at_price || 0) > parseFloat(b.price || 0) ? 1 : 0;
        return db - da;
      });
      _cncgAddBot(msgs, "Here are our best picks 🔥 Tap Offer to make a deal!");
      _cncgRenderProducts(msgs, products, { showNegotiate: true });
    }, 550);
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
  var _typingPhrases = ['Searching…', 'Curating finds…', 'Hunting down the best…', 'Finding perfect matches…', 'Exploring the catalog…', 'Sifting through products…'];
  function _cncgTyping(msgs) {
    var el = document.createElement('div'); el.className = '_btgv_cncg_typing';
    var dots = document.createElement('div'); dots.className = '_btgv_cncg_typing_dots';
    for (var i = 0; i < 3; i++) dots.appendChild(document.createElement('span'));
    el.appendChild(dots);
    var hint = document.createElement('span'); hint.className = '_btgv_cncg_typing_hint';
    hint.textContent = _typingPhrases[0]; el.appendChild(hint);
    var idx = 0;
    var iv = setInterval(function () {
      idx = (idx + 1) % _typingPhrases.length;
      hint.style.opacity = '0';
      setTimeout(function () { hint.textContent = _typingPhrases[idx]; hint.style.opacity = '1'; }, 150);
    }, 1600);
    msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
    return { remove: function () { clearInterval(iv); el.remove(); } };
  }

  function _cncgAddBot(msgs, text) {
    var el = document.createElement('div'); el.className = '_btgv_cncg_bot'; el.textContent = text;
    msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight; return el;
  }

  function _cncgAddUser(msgs, text) {
    var el = document.createElement('div'); el.className = '_btgv_cncg_usr'; el.textContent = text;
    msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
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

  // ── LLM free-form chat with full store catalog ───────────────────────────────
  function _cncgSend(text, msgs, inp, sendBtn) {
    if (!msgs) return;
    inp.value = ''; sendBtn.disabled = true;
    _cncgAddUser(msgs, text);
    _cncgHistory.push({ role: 'user', content: text });
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

    fetch(API_BASE + '/api/widget/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: API_KEY, message: text, history: _cncgHistory.slice(-6), catalog: catalog.slice(0, 12), personality: BOT_PERSONALITY })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        typing.remove();
        if (!d || d.reply === "I'm having trouble right now. Please try again!" || d.reply === "I'm having trouble right now. Try again!") {
          // LLM unavailable — fall back to local keyword search
          var local = _cncgLocalSearch(text);
          if (local.length) {
            _cncgAddBot(msgs, "Here's what I found for you 🛍️");
            _cncgRenderProducts(msgs, local);
          } else {
            _cncgAddBot(msgs, "I couldn't find a match. Try browsing our collections or watching videos!");
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
          if (matched.length) _cncgRenderProducts(msgs, matched);
        }
        msgs.scrollTop = msgs.scrollHeight;
      })
      .catch(function () {
        typing.remove();
        var local = _cncgLocalSearch(text);
        if (local.length) {
          _cncgAddBot(msgs, "Here's what I found 🛍️");
          _cncgRenderProducts(msgs, local);
        } else {
          _cncgAddBot(msgs, "I couldn't find a match. Try browsing collections or watching videos!");
          _cncgBackChip(msgs);
        }
        msgs.scrollTop = msgs.scrollHeight;
      });
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    var path = window.location.pathname;
    // Cart page: show deal banner + confetti only
    if (path === '/cart' || path.startsWith('/cart/')) { handleCartPage(); return; }
    injectStyles();
    rtGetConfig(null); // fetch bot config (bot_name, bot_greeting) from API eagerly

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
