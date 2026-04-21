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
      // Stories bar — centered, scrolls when overflow
      '#btgv-stories{width:100%;background:#fff;border-bottom:1px solid #efefef;display:flex;justify-content:center}',
      '#_btgv_sr{display:flex;gap:16px;padding:14px 20px 16px;overflow-x:auto;max-width:100%;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
      '#_btgv_sr::-webkit-scrollbar{display:none}',
      '._btgv_story{flex-shrink:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;-webkit-tap-highlight-color:transparent}',
      '._btgv_story_ring{width:72px;height:72px;border-radius:50%;padding:2.5px;background:linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)}',
      '._btgv_story_ring.seen{background:#c7c7c7}',
      '._btgv_story_inner{width:100%;height:100%;border-radius:50%;overflow:hidden;border:2.5px solid #fff;background:#222}',
      '._btgv_story_inner img{width:100%;height:100%;object-fit:cover;display:block}',
      '._btgv_story_lbl{font-size:11px;color:#262626;max-width:72px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}',

      // Story viewer
      '#_btgv_sv{position:fixed;inset:0;z-index:99999;background:#000;opacity:0;pointer-events:none;transition:opacity .2s;overflow:hidden;touch-action:none}',
      '#_btgv_sv.open{opacity:1;pointer-events:all}',
      // progress bars
      '._btgv_sv_prog{position:absolute;top:0;left:0;right:0;display:flex;gap:3px;padding:env(safe-area-inset-top,10px) 10px 0;z-index:10;box-sizing:border-box}',
      '@media(min-width:640px){._btgv_sv_prog{max-width:420px;left:50%;transform:translateX(-50%)}}',
      '._btgv_sv_bar{flex:1;height:2px;background:rgba(255,255,255,.4);border-radius:2px;overflow:hidden}',
      '._btgv_sv_fill{height:100%;background:#fff;width:0%;border-radius:2px}',
      // header
      '._btgv_sv_hd{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,10px) + 12px);display:flex;align-items:center;gap:10px;padding:0 12px;z-index:10}',
      '@media(min-width:640px){._btgv_sv_hd{max-width:420px;left:50%;transform:translateX(-50%)}}',
      '._btgv_sv_av{width:36px;height:36px;border-radius:50%;border:1.5px solid rgba(255,255,255,.85);overflow:hidden;flex-shrink:0;background:#333}',
      '._btgv_sv_av img{width:100%;height:100%;object-fit:cover}',
      '._btgv_sv_nm{color:#fff;font-size:13px;font-weight:600;flex:1;text-shadow:0 1px 3px rgba(0,0,0,.5)}',
      '._btgv_sv_x{width:32px;height:32px;background:rgba(0,0,0,.4);border-radius:50%;border:none;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);flex-shrink:0}',
      // video
      '._btgv_sv_vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
      '@media(min-width:640px){._btgv_sv_vid{max-width:420px;left:50%;transform:translateX(-50%);object-fit:contain}}',
      // tap zones — only upper 60% so product shelf is tappable
      '._btgv_sv_tl{position:absolute;left:0;top:0;width:30%;height:60%;z-index:5}',
      '._btgv_sv_tr{position:absolute;right:0;top:0;width:70%;height:60%;z-index:5}',

      // Watch & Shop grid — centered with max-width
      '#btgv-grid{width:100%;max-width:1200px;margin:0 auto;padding-top:8px}',
      '._btgv_gh{font-size:20px;font-weight:800;color:#111;text-align:center;padding:20px 16px 12px;letter-spacing:.5px;text-transform:uppercase}',
      '#_btgv_gi_wrap{overflow-y:scroll;height:min(85vh,720px);scrollbar-width:none;-webkit-overflow-scrolling:touch}',
      '#_btgv_gi_wrap::-webkit-scrollbar{display:none}',
      '#_btgv_gi{display:grid;grid-template-columns:repeat(2,1fr);gap:3px}',
      '@media(min-width:600px){#_btgv_gi{grid-template-columns:repeat(3,1fr)}}',
      '@media(min-width:900px){#_btgv_gi{grid-template-columns:repeat(4,1fr)}}',
      '._btgv_gc{position:relative;aspect-ratio:9/16;overflow:hidden;background:#111;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '._btgv_gc video{width:100%;height:100%;object-fit:cover;display:block}',
      '._btgv_gc_ov{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.65) 0%,transparent 55%);pointer-events:none}',
      '._btgv_gc_tags{position:absolute;bottom:8px;left:8px;right:8px;pointer-events:none}',
      '._btgv_gc_tag{font-size:10px;font-weight:500;color:#fff;background:rgba(0,0,0,.5);backdrop-filter:blur(4px);border-radius:20px;padding:2px 8px;display:inline-block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}',

      // TikTok feed
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
      '._btgv_rail button{background:rgba(0,0,0,.45);backdrop-filter:blur(8px);border:none;border-radius:50%;width:48px;height:48px;color:#fff;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:12px;transition:transform .15s}',
      '._btgv_rail button:active{transform:scale(.9)}',

      // Product shelf — horizontal scrollable cards
      '._btgv_pshelf{position:absolute;bottom:0;left:0;right:0;z-index:8;background:linear-gradient(to top,rgba(0,0,0,.8) 0%,rgba(0,0,0,.25) 80%,transparent 100%);padding-bottom:calc(env(safe-area-inset-bottom,0px) + 10px)}',
      '@media(min-width:640px){._btgv_pshelf{max-width:420px;left:50%;transform:translateX(-50%)}}',
      '._btgv_prow{display:flex;gap:10px;padding:14px 12px 0;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
      '._btgv_prow::-webkit-scrollbar{display:none}',
      '._btgv_pcard{flex-shrink:0;width:170px;scroll-snap-align:start;background:rgba(18,18,18,.82);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.13);border-radius:16px;padding:10px;display:flex;flex-direction:column;gap:9px}',
      '._btgv_pcard_top{display:flex;gap:9px;align-items:flex-start}',
      '._btgv_pcard_img{width:46px;height:46px;border-radius:10px;object-fit:cover;flex-shrink:0;background:#333}',
      '._btgv_pcard_info{flex:1;min-width:0}',
      '._btgv_pcard_name{color:#fff;font-size:12px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '._btgv_pcard_price{color:rgba(255,255,255,.72);font-size:11px;margin-top:3px;display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
      '._btgv_pcard_was{text-decoration:line-through;opacity:.5}',
      '._btgv_pcard_disc{background:#ff4d6d;color:#fff;font-size:8px;font-weight:700;padding:1px 4px;border-radius:4px}',
      '._btgv_pcard_actions{display:flex;gap:5px}',
      '._btgv_icon_btn{flex:1;border:none;border-radius:10px;padding:8px 3px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transition:opacity .15s;-webkit-tap-highlight-color:transparent}',
      '._btgv_icon_btn:active{opacity:.65}',
      '._btgv_icon_lbl{font-size:8px;font-weight:700;line-height:1;white-space:nowrap}',
      '._btgv_ib_cart{background:rgba(255,255,255,.15);color:#fff}',
      '._btgv_ib_buy{background:rgba(99,102,241,.8);color:#fff}',
      '._btgv_ib_neg{background:rgba(236,72,153,.8);color:#fff}',
    ].join('');
    document.head.appendChild(s);
  }

  // ─── Product shelf (horizontal, 3 icon buttons per card) ────────────────────
  function buildProductShelf(tags, videoId) {
    var shelf = document.createElement('div');
    shelf.className = '_btgv_pshelf';
    var row = document.createElement('div');
    row.className = '_btgv_prow';

    tags.forEach(function (tag) {
      var card = document.createElement('div');
      card.className = '_btgv_pcard';

      // Image + info row
      var top = document.createElement('div');
      top.className = '_btgv_pcard_top';

      var img = document.createElement('img');
      img.className = '_btgv_pcard_img';
      img.src = tag.image_url || '';
      img.alt = '';
      img.onerror = function () { this.style.display = 'none'; };

      var info = document.createElement('div');
      info.className = '_btgv_pcard_info';

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
      info.appendChild(nm); info.appendChild(pr);
      top.appendChild(img); top.appendChild(info);

      // 3 icon action buttons
      var actions = document.createElement('div');
      actions.className = '_btgv_pcard_actions';

      function iconBtn(cls, icon, lbl, fn) {
        var btn = document.createElement('button');
        btn.className = '_btgv_icon_btn ' + cls;
        btn.innerHTML = '<span style="font-size:17px">' + icon + '</span><span class="_btgv_icon_lbl">' + lbl + '</span>';
        btn.onclick = function (e) { e.stopPropagation(); fn(btn); };
        return btn;
      }

      var cartBtn = iconBtn('_btgv_ib_cart', '🛒', 'Cart', function (btn) {
        track(videoId, 'add_to_cart', tag.shopify_product_id);
        addToCart(tag.shopify_variant_id, function (ok) {
          fireConfetti();
          if (ok) {
            btn.innerHTML = '<span style="font-size:17px">✓</span><span class="_btgv_icon_lbl">Added</span>';
            setTimeout(function () { btn.innerHTML = '<span style="font-size:17px">🛒</span><span class="_btgv_icon_lbl">Cart</span>'; }, 2500);
          }
        });
      });

      var buyBtn = iconBtn('_btgv_ib_buy', '⚡', 'Buy', function () {
        track(videoId, 'add_to_cart', tag.shopify_product_id);
        addToCart(tag.shopify_variant_id, function (ok) {
          if (ok) { fireConfetti(); window.location.href = '/checkout'; }
        });
      });

      var negBtn = iconBtn('_btgv_ib_neg', '🤝', 'Offer', function (btn) {
        track(videoId, 'negotiate', tag.shopify_product_id);
        fireConfetti();
        if (window._btg && window._btg.openNegotiate) {
          window._btg.openNegotiate(tag.shopify_product_id);
        } else {
          addToCart(tag.shopify_variant_id, function () {});
          btn.innerHTML = '<span style="font-size:17px">✓</span><span class="_btgv_icon_lbl">Sent</span>';
          setTimeout(function () { btn.innerHTML = '<span style="font-size:17px">🤝</span><span class="_btgv_icon_lbl">Offer</span>'; }, 2500);
        }
      });

      actions.appendChild(cartBtn); actions.appendChild(buyBtn); actions.appendChild(negBtn);
      card.appendChild(top); card.appendChild(actions);
      row.appendChild(card);
    });

    shelf.appendChild(row);
    return shelf;
  }

  // ─── Stories bar ────────────────────────────────────────────────────────────
  function buildStoriesBar(container, cols) {
    var row = document.createElement('div');
    row.id = '_btgv_sr';
    cols.forEach(function (col) {
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

    // Progress bars
    var progWrap = document.createElement('div');
    progWrap.className = '_btgv_sv_prog';
    vids.forEach(function () {
      var bar = document.createElement('div'); bar.className = '_btgv_sv_bar';
      var fill = document.createElement('div'); fill.className = '_btgv_sv_fill';
      bar.appendChild(fill); progWrap.appendChild(bar);
    });
    storyEl.appendChild(progWrap);

    // Header
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

    // Tap zones (upper 60% only, so product shelf area stays interactive)
    var tl = document.createElement('div'); tl.className = '_btgv_sv_tl';
    var tr = document.createElement('div'); tr.className = '_btgv_sv_tr';
    tl.onclick = function (e) { e.stopPropagation(); stepStory(-1); };
    tr.onclick = function (e) { e.stopPropagation(); stepStory(1); };
    storyEl.appendChild(tl); storyEl.appendChild(tr);

    // Keyboard nav
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

    // Reset progress bars
    var fills = progWrap.querySelectorAll('._btgv_sv_fill');
    fills.forEach(function (f, i) {
      f.style.transition = 'none';
      f.style.width = i < storyIdx ? '100%' : '0%';
    });
    var fill = fills[storyIdx];

    // Load video
    videoEl.src = vid.s3_url;
    videoEl.muted = false;
    videoEl.currentTime = 0;
    var p = videoEl.play();
    if (p && p.catch) p.catch(function () { videoEl.muted = true; videoEl.play().catch(function () {}); });

    // Animate progress bar
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

    // Product shelf — remove old, attach new
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

  // ─── Watch & Shop grid with auto-scroll ─────────────────────────────────────
  function buildGrid(container, vids) {
    if (!vids.length) return;

    // Title: hide if data-grid-title="" or "none"
    if (GRID_TITLE && GRID_TITLE !== 'none' && GRID_TITLE !== '0') {
      var gh = document.createElement('div');
      gh.className = '_btgv_gh';
      gh.textContent = GRID_TITLE;
      container.appendChild(gh);
    }

    var wrap = document.createElement('div');
    wrap.id = '_btgv_gi_wrap';
    var grid = document.createElement('div');
    grid.id = '_btgv_gi';

    function makeCell(vid, idx) {
      var cell = document.createElement('div');
      cell.className = '_btgv_gc';
      cell.dataset.idx = idx;

      var video = document.createElement('video');
      video.src = vid.s3_url;
      video.muted = true; video.loop = true;
      video.playsInline = true; video.preload = 'metadata';

      var ov = document.createElement('div'); ov.className = '_btgv_gc_ov';
      cell.appendChild(video); cell.appendChild(ov);

      var tags = vid.video_product_tags || [];
      if (tags.length) {
        var tw = document.createElement('div'); tw.className = '_btgv_gc_tags';
        tags.slice(0, 2).forEach(function (t) {
          var tg = document.createElement('div'); tg.className = '_btgv_gc_tag';
          tg.textContent = (t.price ? '$' + parseFloat(t.price).toFixed(0) + ' · ' : '') + t.product_name;
          tw.appendChild(tg);
        });
        cell.appendChild(tw);
      }

      cell.onclick = function () { openFeed(idx, vids); };
      return cell;
    }

    // Original cells
    vids.forEach(function (vid, i) { grid.appendChild(makeCell(vid, i)); });
    // Duplicate for seamless scroll loop
    vids.forEach(function (vid, i) { grid.appendChild(makeCell(vid, i)); });

    wrap.appendChild(grid);
    container.appendChild(wrap);

    // Autoplay via IntersectionObserver
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target.querySelector('video');
        if (!v) return;
        if (e.isIntersecting) v.play().catch(function () {}); else v.pause();
      });
    }, { threshold: 0.3 });
    grid.querySelectorAll('._btgv_gc').forEach(function (c) { io.observe(c); });

    // Auto-scroll: use scrollTop on wrapper, pause on hover/touch
    var paused = false;
    wrap.addEventListener('mouseenter', function () { paused = true; });
    wrap.addEventListener('mouseleave', function () { paused = false; });
    wrap.addEventListener('touchstart', function () { paused = true; }, { passive: true });
    wrap.addEventListener('touchend', function () {
      setTimeout(function () { paused = false; }, 3000);
    }, { passive: true });

    function scrollLoop() {
      if (!paused && wrap.parentNode) {
        wrap.scrollTop += 0.5;
        var half = wrap.scrollHeight / 2;
        if (wrap.scrollTop >= half) wrap.scrollTop = 0;
      }
      requestAnimationFrame(scrollLoop);
    }
    requestAnimationFrame(scrollLoop);
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
      video.src = vid.s3_url;
      video.muted = muted; video.loop = false;
      video.playsInline = true; video.preload = 'metadata';
      // Auto-advance when video ends
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

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var v = entry.target.querySelector('video');
        if (!v) return;
        if (entry.isIntersecting) {
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
