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
  var SESSION_ID = 'btgv_' + Math.random().toString(36).slice(2);

  if (!API_KEY) return;

  var allVideos = [], likedSet = {};
  var storyEl = null, storyVideos = [], storyIdx = 0, storyAnimFrame = null;
  var feedEl = null;

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
      '#_btgv_gi{display:flex;gap:8px}',
      // Cell: 4 per view desktop, 3 tablet, 2 mobile — with slight right-edge peek
      '._btgv_gc{flex-shrink:0;width:calc(25% - 6px);scroll-snap-align:start;position:relative;aspect-ratio:9/16;overflow:hidden;background:#111;cursor:pointer;-webkit-tap-highlight-color:transparent;border-radius:12px}',
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
          '<input id="_btg_e" type="email" placeholder="Email me my private price" required autocomplete="email"' +
          ' style="flex:1;min-width:0;border:1.5px solid #e5e5e5;border-radius:8px;padding:8px 10px;font-size:12px;outline:none;font-family:inherit" />' +
          '<button type="submit" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Unlock →</button>' +
        '</form>' +
        '<div style="font-size:10px;color:#ccc">No spam. Just your deal.</div>';
      msgsEl.appendChild(g); msgsEl.scrollTop = msgsEl.scrollHeight;

      setLoading(false); sendBtn.disabled = true; inp.disabled = true;
      requestAnimationFrame(function () {
        var emailInp = shadow.querySelector('#_btg_e');
        if (emailInp) emailInp.focus();
      });

      shadow.querySelector('#_btg_f').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var em = shadow.querySelector('#_btg_e').value.trim();
        if (!em || em.indexOf('@') < 0) return;
        var submitBtn = shadow.querySelector('#_btg_f button[type=submit]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '...'; }
        fetch(API_BASE + '/api/negotiate/' + negId + '/contact', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: em })
        }).then(function () {
          shadow.querySelectorAll('._btg_p').forEach(function (el) { el.style.filter = 'blur(0px)'; });
          setTimeout(function () {
            g.remove();
            appendMsg('bot', d.bot_reply);
            setLoading(false); sendBtn.disabled = false; inp.disabled = false;
            setTimeout(function () { inp.focus(); }, 80);
          }, 900);
        }).catch(function () {
          // Unblur anyway if contact save fails
          shadow.querySelectorAll('._btg_p').forEach(function (el) { el.style.filter = 'blur(0px)'; });
          setTimeout(function () {
            g.remove();
            appendMsg('bot', d.bot_reply);
            setLoading(false); sendBtn.disabled = false; inp.disabled = false;
          }, 900);
        });
      });
    }

    function showDeal(dealPrice, checkoutUrl, discountCode) {
      if (dealShown) return; dealShown = true;
      var inputRowEl = shadow.querySelector('#input-row'); if (inputRowEl) inputRowEl.remove();
      var saved = Math.round(listPrice - dealPrice);
      var savedPct = Math.round((saved / listPrice) * 100);
      var exp = new Date(Date.now() + 15 * 60 * 1000);

      var ds = document.createElement('div'); ds.className = 'deal-screen';
      ds.innerHTML =
        '<svg class="deal-check" viewBox="0 0 52 52" width="52" height="52">' +
          '<circle cx="26" cy="26" r="24" fill="none" stroke="#1a472a" stroke-width="2"/>' +
          '<path class="checkmark" fill="none" stroke="white" stroke-width="3"' +
          ' stroke-linecap="round" stroke-linejoin="round" d="M14 27l8 8 16-16"' +
          ' stroke-dasharray="36" stroke-dashoffset="36"/></svg>' +
        '<div class="deal-product">' + (tag.product_name || '') + '</div>' +
        '<div class="deal-orig-num">' + (listPrice !== dealPrice ? '$' + Math.round(listPrice) : '') + '</div>' +
        '<div class="deal-price-wrap"><div class="deal-price-num" id="_dp">$' + Math.round(listPrice) + '</div></div>' +
        '<div class="deal-savings" id="_ds">' + (saved > 0 ? 'You saved $' + saved + ' &middot; ' + savedPct + '% off' : 'Deal locked in') + '</div>' +
        (discountCode ? '<div class="deal-code-line">' + discountCode + ' applied automatically</div>' : '') +
        '<div class="deal-timer-wrap"><div class="deal-timer-digits" id="_dtd">15:00</div><div class="deal-timer-label">Deal expires in</div></div>' +
        '<button class="deal-fallback" id="_dfb">Go to cart &rarr;</button>' +
        '<div class="deal-progress" id="_dpr"></div>';
      panel.appendChild(ds);
      requestAnimationFrame(function () { ds.classList.add('visible'); });

      setTimeout(function () {
        var from = Math.round(listPrice), to = Math.round(dealPrice), dur = 700, start = null;
        function step(now) {
          if (!start) start = now;
          var t = Math.min((now - start) / dur, 1);
          var eased = 1 - Math.pow(1 - t, 3);
          var os = (t > 0.85 && t < 1) ? Math.sin(((t - 0.85) / 0.15) * Math.PI) * 2 : 0;
          var el = shadow.querySelector('#_dp');
          if (el) el.textContent = '$' + Math.round(from - (from - to) * eased + os);
          if (t < 1) { requestAnimationFrame(step); }
          else {
            if (el) el.textContent = '$' + to;
            var badge = shadow.querySelector('#_ds'); if (badge) badge.classList.add('show');
          }
        }
        requestAnimationFrame(step);
      }, 500);

      var timerInterval = setInterval(function () {
        var remaining = Math.max(0, exp - Date.now());
        var mins = Math.floor(remaining / 60000), secs = Math.floor((remaining % 60000) / 1000);
        var timerEl = shadow.querySelector('#_dtd');
        if (timerEl) {
          timerEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
          if (remaining < 120000) timerEl.classList.add('urgent');
        }
        if (remaining <= 0) {
          clearInterval(timerInterval);
          if (timerEl) timerEl.textContent = 'Expired';
        }
      }, 1000);

      setTimeout(function () {
        var fb = shadow.querySelector('#_dfb');
        if (!fb) return;
        fb.style.display = 'block'; fb.textContent = 'Complete my order →';
        fb.onclick = function () {
          fb.textContent = 'Adding to cart...'; fb.disabled = true;
          addToCart(tag.shopify_variant_id, function () {
            var cartPath = discountCode ? '/cart?discount=' + discountCode : '/cart';
            window.location.href = cartPath;
          });
        };
      }, 1800);
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
    setTimeout(function () { doNegotiate(null); }, 1200);
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

    // Build cells
    vids.forEach(function (vid, i) {
      var cell = document.createElement('div');
      cell.className = '_btgv_gc';

      var video = document.createElement('video');
      video.dataset.src = vid.s3_url; // lazy — src set when visible
      video.muted = true; video.loop = true;
      video.playsInline = true; video.preload = 'none';

      var ov = document.createElement('div'); ov.className = '_btgv_gc_ov';
      cell.appendChild(video); cell.appendChild(ov);

      // Product overlay directly on the card (first product + action buttons)
      var tags = vid.video_product_tags || [];
      if (tags.length > 0) {
        var tag = tags[0];
        var price = parseFloat(tag.price || 0);

        var prod = document.createElement('div');
        prod.className = '_btgv_gc_prod';

        var pnm = document.createElement('div');
        pnm.className = '_btgv_gc_prod_nm';
        pnm.textContent = tag.product_name + (tags.length > 1 ? '  +' + (tags.length - 1) + ' more' : '');
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

        pbtns.appendChild(cellBtn('_btgv_gc_pb_cart', '🛒', 'Cart', function (btn) {
          track(vid.id, 'add_to_cart', tag.shopify_product_id);
          addToCart(tag.shopify_variant_id, function (ok) {
            fireConfetti();
            if (ok) {
              btn.innerHTML = '<span>✓</span><span>Added</span>';
              setTimeout(function () { btn.innerHTML = '<span>🛒</span><span>Cart</span>'; }, 2500);
            }
          });
        }));

        pbtns.appendChild(cellBtn('_btgv_gc_pb_buy', '⚡', 'Buy', function () {
          track(vid.id, 'add_to_cart', tag.shopify_product_id);
          addToCart(tag.shopify_variant_id, function (ok) {
            if (ok) { fireConfetti(); window.location.href = '/checkout'; }
          });
        }));

        pbtns.appendChild(cellBtn('_btgv_gc_pb_neg', '🤝', 'Negotiate', function () {
          track(vid.id, 'negotiate', tag.shopify_product_id);
          openNegotiateModal(tag);
        }));

        prod.appendChild(pbtns);
        cell.appendChild(prod);
      }

      // Tap video area (not buttons) → open TikTok feed
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

    // Check if next arrow should be hidden (≤4 videos that all fit)
    // Also enforce 9:16 cell height — aspect-ratio on flex children is unreliable in some browsers
    function fixCellHeights() {
      var cells = grid.querySelectorAll('._btgv_gc');
      if (!cells.length) return;
      var w = cells[0].offsetWidth;
      if (w > 0) cells.forEach(function (c) { c.style.height = Math.round(w * 16 / 9) + 'px'; });
    }
    requestAnimationFrame(function () { updateArrows(); fixCellHeights(); });
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

    vids.forEach(function (vid, i) {
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
      likeBtn.innerHTML = '<span style="font-size:22px">🤍</span><span>' + likeCount + '</span>';
      likeBtn.onclick = function (e) {
        e.stopPropagation();
        if (!likedSet[vid.id]) {
          likedSet[vid.id] = true;
          likeBtn.querySelectorAll('span')[0].textContent = '❤️';
          likeCount++;
          likeBtn.querySelectorAll('span')[1].textContent = likeCount;
          track(vid.id, 'like');
        }
      };
      var shareBtn = document.createElement('button');
      shareBtn.innerHTML = '<span style="font-size:20px">↗️</span><span>Share</span>';
      shareBtn.onclick = function (e) {
        e.stopPropagation();
        track(vid.id, 'share');
        if (navigator.share) navigator.share({ url: window.location.href }).catch(function () {});
      };
      rail.appendChild(likeBtn); rail.appendChild(shareBtn);

      slide.appendChild(video); slide.appendChild(grad); slide.appendChild(rail);
      var tags = vid.video_product_tags || [];
      if (tags.length) slide.appendChild(buildProductShelf(tags, vid.id));

      scroll.appendChild(slide);
    });

    // Lazy load per slide as it scrolls into view
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var v = entry.target.querySelector('video');
        if (!v) return;
        if (entry.isIntersecting) {
          if (v.dataset.src && !v.src) { v.src = v.dataset.src; }
          v.play().catch(function () {});
          var idx = Array.from(scroll.children).indexOf(entry.target);
          if (idx >= 0 && vids[idx]) track(vids[idx].id, 'view');
        } else {
          v.pause();
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
    });
  }

  function closeFeed() {
    if (!feedEl) return;
    feedEl.classList.remove('open');
    feedEl.querySelectorAll('video').forEach(function (v) { v.pause(); v.src = ''; });
    setTimeout(function () { if (feedEl) { feedEl.remove(); feedEl = null; } }, 280);
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    var storiesCont = getStoriesContainer();
    var gridCont = getGridContainer();

    fetchCollections(function (cols) {
      if (cols.length) buildStoriesBar(storiesCont, cols);
    });

    fetchAllVideos(function (vids) {
      allVideos = vids;
      if (vids.length) buildGrid(gridCont, vids);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
