(function () {
  'use strict';

  // ─── Config from script tag ────────────────────────────────────────────────
  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var API_KEY = script.getAttribute('data-key') || '';
  var MODE = script.getAttribute('data-mode') || 'stories'; // 'stories' | 'carousel' | 'feed'
  var API_BASE = script.getAttribute('data-api') || 'https://botiga-api-two.vercel.app';
  var WIDGET_ID = script.getAttribute('data-widget') || ''; // optional named collection ID
  var SESSION_ID = 'btgv_' + Math.random().toString(36).slice(2);

  if (!API_KEY) return console.warn('[Botiga Video] Missing data-key attribute');

  // ─── State ─────────────────────────────────────────────────────────────────
  var videos = [];
  var currentIndex = 0;
  var feedOpen = false;
  var feedEl = null;
  var likedSet = {};

  // ─── Fetch videos ──────────────────────────────────────────────────────────
  function fetchVideos(cb) {
    var url = API_BASE + '/api/widget/videos?k=' + API_KEY;
    if (WIDGET_ID) url += '&w=' + WIDGET_ID;
    fetch(url)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) { videos = data || []; cb(); })
      .catch(function () { cb(); });
  }

  // ─── Analytics ─────────────────────────────────────────────────────────────
  function track(videoId, eventType, productId) {
    fetch(API_BASE + '/api/widget/videos/' + videoId + '/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: API_KEY, event_type: eventType, session_id: SESSION_ID, product_id: productId || null })
    }).catch(function () {});
  }

  // ─── Styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('_btgv_css')) return;
    var style = document.createElement('style');
    style.id = '_btgv_css';
    style.textContent = [
      /* Feed overlay */
      '#_btgv_feed{position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-direction:column;opacity:0;pointer-events:none;transition:opacity .25s}',
      '#_btgv_feed.open{opacity:1;pointer-events:all}',
      /* Scroll container */
      '#_btgv_scroll{flex:1;overflow-y:scroll;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
      '#_btgv_scroll::-webkit-scrollbar{display:none}',
      /* Each slide */
      '._btgv_slide{position:relative;width:100%;height:100dvh;scroll-snap-align:start;scroll-snap-stop:always;display:flex;align-items:center;justify-content:center;background:#000;flex-shrink:0}',
      '._btgv_slide video{width:100%;height:100%;object-fit:cover;display:block}',
      /* Desktop: constrain width */
      '@media(min-width:640px){._btgv_slide{justify-content:center}._btgv_slide video{max-width:420px;border-radius:16px}}',
      /* Gradient overlay */
      '._btgv_grad{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.75) 0%,rgba(0,0,0,.2) 40%,transparent 70%);pointer-events:none}',
      '@media(min-width:640px){._btgv_grad{max-width:420px;left:50%;transform:translateX(-50%);border-radius:16px}}',
      /* Close button */
      '#_btgv_close{position:absolute;top:env(safe-area-inset-top,16px);right:16px;width:36px;height:36px;background:rgba(0,0,0,.5);border-radius:50%;border:none;color:#fff;font-size:20px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)}',
      /* Right action rail */
      '._btgv_rail{position:absolute;right:12px;bottom:180px;display:flex;flex-direction:column;align-items:center;gap:20px;z-index:5}',
      '@media(min-width:640px){._btgv_rail{right:calc(50% - 420px/2 + 12px)}}',
      '._btgv_rail button{background:rgba(0,0,0,.45);backdrop-filter:blur(8px);border:none;border-radius:50%;width:48px;height:48px;color:#fff;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;transition:transform .15s}',
      '._btgv_rail button:active{transform:scale(.9)}',
      '._btgv_rail button span:first-child{font-size:22px;line-height:1}',
      '._btgv_rail button span:last-child{font-size:10px;line-height:1;opacity:.85}',
      '._btgv_liked{color:#ff4d6d!important}',
      /* Mute button */
      '._btgv_mute{position:absolute;top:env(safe-area-inset-top,16px);left:16px;width:36px;height:36px;background:rgba(0,0,0,.5);border-radius:50%;border:none;color:#fff;font-size:16px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)}',
      '@media(min-width:640px){._btgv_mute{left:calc(50% - 420px/2 + 12px)}}',
      /* Bottom product bar */
      '._btgv_bar{position:absolute;bottom:0;left:0;right:0;padding:16px 16px calc(env(safe-area-inset-bottom,0px) + 16px);z-index:5}',
      '@media(min-width:640px){._btgv_bar{left:50%;transform:translateX(-50%);width:420px}}',
      /* Product card */
      '._btgv_product{background:rgba(255,255,255,.12);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.18);border-radius:16px;padding:12px;margin-bottom:10px;display:flex;align-items:center;gap:10px}',
      '._btgv_product img{width:48px;height:48px;border-radius:10px;object-fit:cover;flex-shrink:0}',
      '._btgv_product_info{flex:1;min-width:0}',
      '._btgv_product_name{color:#fff;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '._btgv_product_price{color:rgba(255,255,255,.8);font-size:12px;margin-top:2px}',
      '._btgv_product_was{text-decoration:line-through;opacity:.6;font-size:11px;margin-left:4px}',
      '._btgv_discount{background:#ff4d6d;color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;margin-left:4px}',
      /* CTA buttons */
      '._btgv_ctas{display:flex;gap:8px}',
      '._btgv_btn{flex:1;border:none;border-radius:12px;padding:12px 8px;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s;letter-spacing:.01em}',
      '._btgv_btn:active{opacity:.8}',
      '._btgv_btn_cart{background:#fff;color:#111}',
      '._btgv_btn_buy{background:#111;color:#fff}',
      '._btgv_btn_neg{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff}',
      /* Stories row */
      '#_btgv_stories{display:flex;gap:10px;padding:8px 16px;overflow-x:auto;scrollbar-width:none}',
      '#_btgv_stories::-webkit-scrollbar{display:none}',
      '._btgv_story{flex-shrink:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px}',
      '._btgv_story_ring{width:64px;height:64px;border-radius:50%;padding:2.5px;background:linear-gradient(135deg,#6366f1,#ec4899,#f59e0b)}',
      '._btgv_story_inner{width:100%;height:100%;border-radius:50%;overflow:hidden;border:2.5px solid #fff;background:#111}',
      '._btgv_story_inner video,._btgv_story_inner img{width:100%;height:100%;object-fit:cover}',
      '._btgv_story_label{font-size:10px;color:#374151;text-align:center;max-width:64px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      /* Carousel */
      '#_btgv_carousel{display:flex;gap:10px;padding:8px 16px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}',
      '#_btgv_carousel::-webkit-scrollbar{display:none}',
      '._btgv_card{flex-shrink:0;width:180px;scroll-snap-align:start;cursor:pointer;border-radius:16px;overflow:hidden;position:relative;background:#111}',
      '._btgv_card video{width:100%;height:260px;object-fit:cover;display:block}',
      '._btgv_card_overlay{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(to top,rgba(0,0,0,.8),transparent);padding:10px;color:#fff}',
      '._btgv_card_name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '._btgv_card_price{font-size:11px;opacity:.8}',
      /* Negotiate sheet */
      '#_btgv_neg_sheet{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .25s}',
      '#_btgv_neg_sheet.open{opacity:1;pointer-events:all}',
      '#_btgv_neg_inner{background:#fff;border-radius:24px 24px 0 0;padding:20px;max-height:75dvh;overflow-y:auto}',
      '#_btgv_neg_msgs{min-height:80px;max-height:35dvh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px}',
      '._btgv_msg{max-width:80%;padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.4}',
      '._btgv_msg.bot{background:#f3f4f6;color:#111;align-self:flex-start;border-bottom-left-radius:4px}',
      '._btgv_msg.user{background:#6366f1;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}',
      '._btgv_neg_input_row{display:flex;gap:8px}',
      '#_btgv_neg_input{flex:1;border:1.5px solid #e5e7eb;border-radius:12px;padding:10px 14px;font-size:14px;outline:none}',
      '#_btgv_neg_input:focus{border-color:#6366f1}',
      '#_btgv_neg_send{background:#6366f1;color:#fff;border:none;border-radius:12px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}',
      '#_btgv_neg_close{position:absolute;top:16px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280}',
      /* Confetti / deal card */
      '._btgv_deal{background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1.5px solid #6ee7b7;border-radius:16px;padding:16px;text-align:center;margin-bottom:12px}',
      '._btgv_deal_price{font-size:28px;font-weight:800;color:#065f46}',
      '._btgv_deal_sub{font-size:13px;color:#047857;margin-top:2px}',
      '._btgv_deal_btn{display:block;width:100%;background:#059669;color:#fff;border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;margin-top:12px;text-decoration:none;text-align:center}',
    ].join('');
    document.head.appendChild(style);
  }

  // ─── Build feed slide ──────────────────────────────────────────────────────
  function buildSlide(video, index) {
    var slide = document.createElement('div');
    slide.className = '_btgv_slide';
    slide.dataset.index = index;
    slide.dataset.vid = video.id;

    var vid = document.createElement('video');
    vid.src = video.s3_url;
    vid.playsInline = true;
    vid.muted = true;
    vid.loop = true;
    vid.preload = 'metadata';
    slide.appendChild(vid);

    var grad = document.createElement('div');
    grad.className = '_btgv_grad';
    slide.appendChild(grad);

    // Mute toggle
    var muteBtn = document.createElement('button');
    muteBtn.className = '_btgv_mute';
    muteBtn.innerHTML = '🔇';
    muteBtn.onclick = function (e) {
      e.stopPropagation();
      vid.muted = !vid.muted;
      muteBtn.innerHTML = vid.muted ? '🔇' : '🔊';
    };
    slide.appendChild(muteBtn);

    // Right rail: like, share, negotiate
    var rail = document.createElement('div');
    rail.className = '_btgv_rail';

    function makeRailBtn(icon, label, onClick) {
      var btn = document.createElement('button');
      var iconEl = document.createElement('span');
      iconEl.textContent = icon;
      var labelEl = document.createElement('span');
      labelEl.textContent = label;
      btn.appendChild(iconEl);
      btn.appendChild(labelEl);
      btn.onclick = onClick;
      return { btn: btn, iconEl: iconEl, labelEl: labelEl };
    }

    // Like
    var likeCount = video.likes_count || 0;
    var likeObj = makeRailBtn('❤️', String(likeCount), function (e) {
      e.stopPropagation();
      if (likedSet[video.id]) return;
      likedSet[video.id] = true;
      likeCount++;
      likeObj.iconEl.textContent = '❤️';
      likeObj.iconEl.classList.add('_btgv_liked');
      likeObj.labelEl.textContent = String(likeCount);
      track(video.id, 'like');
    });
    rail.appendChild(likeObj.btn);

    // Share
    var shareObj = makeRailBtn('↗️', 'Share', function (e) {
      e.stopPropagation();
      if (navigator.share) {
        navigator.share({ url: window.location.href }).catch(function () {});
      } else {
        navigator.clipboard.writeText(window.location.href).catch(function () {});
      }
      track(video.id, 'share');
    });
    rail.appendChild(shareObj.btn);

    var products = video.video_product_tags || [];
    var firstProduct = products[0] || null;
    var activeProductIndex = 0;

    // Negotiate rail button — updates when active product changes
    var negRailObj = null;
    if (firstProduct) {
      negRailObj = makeRailBtn('✦', 'Negotiate', function (e) {
        e.stopPropagation();
        var p = products[activeProductIndex] || firstProduct;
        openNegSheet(slide, vid, video, p);
        track(video.id, 'negotiate', p.shopify_product_id);
      });
      negRailObj.btn.style.background = 'linear-gradient(135deg,rgba(99,102,241,.7),rgba(139,92,246,.7))';
      rail.appendChild(negRailObj.btn);
    }

    slide.appendChild(rail);

    // Bottom bar: swipeable product carousel + CTAs
    var bar = document.createElement('div');
    bar.className = '_btgv_bar';

    if (products.length > 0) {
      // ── Product card (swipeable) ──
      var productWrap = document.createElement('div');
      productWrap.style.cssText = 'position:relative;margin-bottom:10px;touch-action:pan-y';

      var productEl = document.createElement('div');
      productEl.className = '_btgv_product';
      productEl.style.cssText += ';cursor:' + (products.length > 1 ? 'grab' : 'default') + ';user-select:none';
      productWrap.appendChild(productEl);

      // Dots (only if multiple products)
      var dotsEl = null;
      if (products.length > 1) {
        dotsEl = document.createElement('div');
        dotsEl.style.cssText = 'display:flex;justify-content:center;gap:5px;margin-top:6px';
        products.forEach(function (_, i) {
          var dot = document.createElement('div');
          dot.style.cssText = 'width:5px;height:5px;border-radius:50%;background:' + (i === 0 ? '#fff' : 'rgba(255,255,255,.4)') + ';transition:background .2s';
          dotsEl.appendChild(dot);
        });
        productWrap.appendChild(dotsEl);
      }

      bar.appendChild(productWrap);

      // ── CTAs ──
      var ctas = document.createElement('div');
      ctas.className = '_btgv_ctas';

      var cartBtn = document.createElement('button');
      cartBtn.className = '_btgv_btn _btgv_btn_cart';
      cartBtn.textContent = 'Add to Cart';

      var buyBtn = document.createElement('button');
      buyBtn.className = '_btgv_btn _btgv_btn_buy';
      buyBtn.textContent = 'Buy Now';

      var negBtn = document.createElement('button');
      negBtn.className = '_btgv_btn _btgv_btn_neg';
      negBtn.textContent = '✦ Negotiate';

      ctas.appendChild(cartBtn);
      ctas.appendChild(buyBtn);
      ctas.appendChild(negBtn);
      bar.appendChild(ctas);

      // ── Render active product into card ──
      function renderProduct(idx) {
        activeProductIndex = idx;
        var p = products[idx];

        // Clear card
        while (productEl.firstChild) productEl.removeChild(productEl.firstChild);

        if (p.image_url) {
          var img = document.createElement('img');
          img.src = p.image_url;
          img.alt = p.product_name;
          productEl.appendChild(img);
        }

        var info = document.createElement('div');
        info.className = '_btgv_product_info';

        var nameEl = document.createElement('div');
        nameEl.className = '_btgv_product_name';
        nameEl.textContent = p.product_name;
        info.appendChild(nameEl);

        var priceEl = document.createElement('div');
        priceEl.className = '_btgv_product_price';
        if (p.price) {
          priceEl.textContent = '$' + parseFloat(p.price).toFixed(2);
          if (p.compare_at_price && parseFloat(p.compare_at_price) > parseFloat(p.price)) {
            var wasEl = document.createElement('span');
            wasEl.className = '_btgv_product_was';
            wasEl.textContent = '$' + parseFloat(p.compare_at_price).toFixed(2);
            priceEl.appendChild(wasEl);
            var pct = Math.round((1 - p.price / p.compare_at_price) * 100);
            var discEl = document.createElement('span');
            discEl.className = '_btgv_discount';
            discEl.textContent = pct + '% off';
            priceEl.appendChild(discEl);
          }
        }
        info.appendChild(priceEl);

        // Counter badge if multiple products
        if (products.length > 1) {
          var badge = document.createElement('div');
          badge.style.cssText = 'font-size:10px;color:rgba(255,255,255,.7);margin-top:1px';
          badge.textContent = (idx + 1) + ' / ' + products.length;
          info.appendChild(badge);
        }

        productEl.appendChild(info);

        // Arrow hint (right side)
        if (products.length > 1) {
          var arrow = document.createElement('div');
          arrow.style.cssText = 'font-size:14px;color:rgba(255,255,255,.6);flex-shrink:0;padding-left:4px';
          arrow.textContent = idx < products.length - 1 ? '›' : '‹';
          productEl.appendChild(arrow);
        }

        // Update dots
        if (dotsEl) {
          Array.from(dotsEl.children).forEach(function (dot, i) {
            dot.style.background = i === idx ? '#fff' : 'rgba(255,255,255,.4)';
          });
        }

        // Update CTA buttons
        cartBtn.onclick = function (e) {
          e.stopPropagation();
          addToCart(p);
          track(video.id, 'add_to_cart', p.shopify_product_id);
        };
        buyBtn.onclick = function (e) {
          e.stopPropagation();
          buyNow(p);
          track(video.id, 'buy_now', p.shopify_product_id);
        };
        negBtn.onclick = function (e) {
          e.stopPropagation();
          openNegSheet(slide, vid, video, p);
          track(video.id, 'negotiate', p.shopify_product_id);
        };
      }

      renderProduct(0);

      // ── Swipe gesture (touch + mouse) ──
      if (products.length > 1) {
        var swipeStartX = 0;
        var swipeStartY = 0;
        var swiping = false;

        productEl.addEventListener('touchstart', function (e) {
          swipeStartX = e.touches[0].clientX;
          swipeStartY = e.touches[0].clientY;
          swiping = true;
        }, { passive: true });

        productEl.addEventListener('touchend', function (e) {
          if (!swiping) return;
          swiping = false;
          var dx = e.changedTouches[0].clientX - swipeStartX;
          var dy = e.changedTouches[0].clientY - swipeStartY;
          if (Math.abs(dx) < 30 || Math.abs(dy) > Math.abs(dx)) return; // not horizontal
          if (dx < 0 && activeProductIndex < products.length - 1) renderProduct(activeProductIndex + 1);
          if (dx > 0 && activeProductIndex > 0) renderProduct(activeProductIndex - 1);
        }, { passive: true });

        // Mouse drag (desktop)
        productEl.addEventListener('mousedown', function (e) {
          swipeStartX = e.clientX;
          swiping = true;
        });
        productEl.addEventListener('mouseup', function (e) {
          if (!swiping) return;
          swiping = false;
          var dx = e.clientX - swipeStartX;
          if (Math.abs(dx) < 20) return;
          if (dx < 0 && activeProductIndex < products.length - 1) renderProduct(activeProductIndex + 1);
          if (dx > 0 && activeProductIndex > 0) renderProduct(activeProductIndex - 1);
        });
        productEl.addEventListener('mouseleave', function () { swiping = false; });
      }
    }

    slide.appendChild(bar);

    // Negotiate sheet (injected inside slide, uses active product)
    var negSheet = buildNegSheet(slide, vid, video, firstProduct);
    slide.appendChild(negSheet);

    return slide;
  }

  // ─── Negotiate sheet ────────────────────────────────────────────────────────
  function buildNegSheet(slide, vid, video, product) {
    var sheet = document.createElement('div');
    sheet.id = '_btgv_neg_sheet_' + video.id;
    sheet.className = '';
    sheet.style.cssText = 'position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .25s';

    var inner = document.createElement('div');
    inner.style.cssText = 'background:#fff;border-radius:24px 24px 0 0;padding:20px;max-height:75dvh;overflow-y:auto;position:relative';

    var closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;background:none;border:none;font-size:24px;cursor:pointer;color:#6b7280;line-height:1';
    closeBtn.onclick = function () { closeNegSheet(sheet, vid); };
    inner.appendChild(closeBtn);

    var title = document.createElement('p');
    title.style.cssText = 'font-size:15px;font-weight:700;color:#111;margin-bottom:16px;padding-right:32px';
    title.textContent = product ? 'Negotiate — ' + product.product_name : 'Make an offer';
    inner.appendChild(title);

    var msgs = document.createElement('div');
    msgs.style.cssText = 'min-height:60px;max-height:35dvh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px';
    inner.appendChild(msgs);

    var inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:8px';

    var input = document.createElement('input');
    input.placeholder = 'Make your offer...';
    input.style.cssText = 'flex:1;border:1.5px solid #e5e7eb;border-radius:12px;padding:10px 14px;font-size:14px;outline:none';
    input.onfocus = function () { input.style.borderColor = '#6366f1'; };
    input.onblur = function () { input.style.borderColor = '#e5e7eb'; };

    var sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText = 'background:#6366f1;color:#fff;border:none;border-radius:12px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer';

    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    inner.appendChild(inputRow);
    sheet.appendChild(inner);

    // State
    var negId = null;
    var sending = false;

    function addMsg(role, text) {
      var m = document.createElement('div');
      m.style.cssText = 'max-width:80%;padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.4;' +
        (role === 'bot'
          ? 'background:#f3f4f6;color:#111;align-self:flex-start;border-bottom-left-radius:4px'
          : 'background:#6366f1;color:#fff;align-self:flex-end;border-bottom-right-radius:4px');
      m.textContent = text;
      msgs.appendChild(m);
      msgs.scrollTop = msgs.scrollHeight;
      return m;
    }

    function showDeal(dealPrice, checkoutUrl, discountCode, expiresAt) {
      msgs.innerHTML = '';
      input.disabled = true;
      sendBtn.disabled = true;

      var deal = document.createElement('div');
      deal.style.cssText = 'background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1.5px solid #6ee7b7;border-radius:16px;padding:16px;text-align:center;margin-bottom:12px';

      var priceEl = document.createElement('div');
      priceEl.style.cssText = 'font-size:28px;font-weight:800;color:#065f46';
      priceEl.textContent = '$' + parseFloat(dealPrice).toFixed(2);

      var sub = document.createElement('div');
      sub.style.cssText = 'font-size:13px;color:#047857;margin-top:2px';
      sub.textContent = discountCode ? 'Code: ' + discountCode : 'Deal locked in!';

      var chkBtn = document.createElement('a');
      chkBtn.href = checkoutUrl || '#';
      chkBtn.target = '_top';
      chkBtn.style.cssText = 'display:block;width:100%;background:#059669;color:#fff;border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;margin-top:12px;text-decoration:none;text-align:center;box-sizing:border-box';
      chkBtn.textContent = '🛍 Checkout Now';

      deal.appendChild(priceEl);
      deal.appendChild(sub);
      deal.appendChild(chkBtn);
      msgs.parentNode.insertBefore(deal, msgs);
    }

    async function send(isOpening) {
      if (sending) return;
      var msg = input.value.trim();
      if (!isOpening && !msg) return;
      sending = true;
      sendBtn.disabled = true;
      if (!isOpening) { addMsg('user', msg); input.value = ''; }

      var loadingEl = addMsg('bot', '...');
      loadingEl.style.opacity = '.5';

      try {
        var body = {
          session_id: SESSION_ID,
          negotiation_id: negId,
          list_price: product ? parseFloat(product.price) : 0,
          product_name: product ? product.product_name : video.title || 'this item',
          product_url: product ? (window.location.origin + '/products/' + product.product_handle) : null,
          product_image: product ? product.image_url : null,
          variant_id: product ? product.shopify_variant_id : null,
          customer_message: isOpening ? null : msg,
          opening: isOpening ? true : undefined,
        };

        var res = await fetch(API_BASE + '/api/negotiate?k=' + API_KEY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        var data = await res.json();
        msgs.removeChild(loadingEl);

        if (data.negotiation_id) negId = data.negotiation_id;

        if (data.status === 'won' && data.deal_price) {
          showDeal(data.deal_price, data.checkout_url, data.discount_code, data.expires_at);
          track(video.id, 'checkout', product ? product.shopify_product_id : null);
        } else {
          addMsg('bot', data.bot_reply || 'Let me check on that...');

          // Accept chips
          if (data.is_final_offer || (data.bot_reply && data.bot_reply.match(/\$[\d,]+/))) {
            var chips = document.createElement('div');
            chips.style.cssText = 'display:flex;gap:8px;margin-top:4px';

            var acceptBtn = document.createElement('button');
            acceptBtn.textContent = '✓ Accept';
            acceptBtn.style.cssText = 'flex:1;background:#059669;color:#fff;border:none;border-radius:10px;padding:9px;font-size:13px;font-weight:600;cursor:pointer';
            acceptBtn.onclick = function () { chips.remove(); input.value = 'I accept'; send(false); };

            var counterBtn = document.createElement('button');
            counterBtn.textContent = 'Make a counter';
            counterBtn.style.cssText = 'flex:1;background:#f3f4f6;color:#374151;border:none;border-radius:10px;padding:9px;font-size:13px;font-weight:600;cursor:pointer';
            counterBtn.onclick = function () { chips.remove(); input.focus(); };

            chips.appendChild(counterBtn);
            chips.appendChild(acceptBtn);
            msgs.appendChild(chips);
            msgs.scrollTop = msgs.scrollHeight;
          }
        }
      } catch (err) {
        msgs.removeChild(loadingEl);
        addMsg('bot', 'Something went wrong. Try again.');
      }

      sending = false;
      sendBtn.disabled = false;
    }

    sendBtn.onclick = function () { send(false); };
    input.onkeydown = function (e) { if (e.key === 'Enter') send(false); };

    sheet._openNeg = function () {
      sheet.style.opacity = '0';
      sheet.style.pointerEvents = 'all';
      requestAnimationFrame(function () { sheet.style.opacity = '1'; });
      if (!negId) send(true); // trigger opening message
    };
    sheet._closeNeg = function () {
      sheet.style.opacity = '0';
      sheet.style.pointerEvents = 'none';
    };

    return sheet;
  }

  function openNegSheet(slide, vid, video) {
    vid.pause();
    var sheet = slide.querySelector('[id^="_btgv_neg_sheet_"]');
    if (sheet && sheet._openNeg) sheet._openNeg();
  }

  function closeNegSheet(sheet, vid) {
    sheet._closeNeg();
    setTimeout(function () { vid.play(); }, 300);
  }

  // ─── Shopify cart actions ───────────────────────────────────────────────────
  function addToCart(product) {
    var variantId = product.shopify_variant_id;
    if (!variantId) return;
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variantId, quantity: 1 }),
    })
      .then(function () {
        // Flash confirmation
        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 20px;border-radius:30px;font-size:13px;font-weight:600;z-index:999999;pointer-events:none;opacity:0;transition:opacity .2s';
        toast.textContent = '✓ Added to cart';
        document.body.appendChild(toast);
        requestAnimationFrame(function () { toast.style.opacity = '1'; });
        setTimeout(function () { toast.style.opacity = '0'; setTimeout(function () { toast.remove(); }, 300); }, 2000);
      })
      .catch(function () {});
  }

  function buyNow(product) {
    var variantId = product.shopify_variant_id;
    if (!variantId) return;
    window.location.href = '/cart/' + variantId + ':1';
  }

  // ─── IntersectionObserver for autoplay ─────────────────────────────────────
  function setupObserver(scrollEl) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var vid = entry.target.querySelector('video');
        if (!vid) return;
        if (entry.isIntersecting) {
          vid.play().catch(function () {});
          currentIndex = parseInt(entry.target.dataset.index || 0);
          track(entry.target.dataset.vid, 'view');
        } else {
          vid.pause();
        }
      });
    }, { root: scrollEl, threshold: 0.6 });

    scrollEl.querySelectorAll('._btgv_slide').forEach(function (slide) {
      observer.observe(slide);
    });
  }

  // ─── Build the full-screen feed ─────────────────────────────────────────────
  function buildFeed(startIndex) {
    if (feedEl) { feedEl.remove(); feedEl = null; }

    var feed = document.createElement('div');
    feed.id = '_btgv_feed';
    document.body.appendChild(feed);
    feedEl = feed;

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.id = '_btgv_close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = closeFeed;
    feed.appendChild(closeBtn);

    // Scroll container
    var scroll = document.createElement('div');
    scroll.id = '_btgv_scroll';
    feed.appendChild(scroll);

    // Build slides
    videos.forEach(function (video, i) {
      scroll.appendChild(buildSlide(video, i));
    });

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Open
    requestAnimationFrame(function () {
      feed.classList.add('open');
      // Jump to start index
      var slides = scroll.querySelectorAll('._btgv_slide');
      if (slides[startIndex]) {
        slides[startIndex].scrollIntoView({ behavior: 'instant' });
      }
      setupObserver(scroll);
    });

    // Keyboard nav
    document.addEventListener('keydown', onKey);
    feedOpen = true;
  }

  function closeFeed() {
    if (!feedEl) return;
    feedEl.classList.remove('open');
    setTimeout(function () {
      if (feedEl) { feedEl.remove(); feedEl = null; }
      document.body.style.overflow = '';
      feedOpen = false;
    }, 250);
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') closeFeed();
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && currentIndex < videos.length - 1) {
      var next = feedEl.querySelector('[data-index="' + (currentIndex + 1) + '"]');
      if (next) next.scrollIntoView({ behavior: 'smooth' });
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && currentIndex > 0) {
      var prev = feedEl.querySelector('[data-index="' + (currentIndex - 1) + '"]');
      if (prev) prev.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // ─── Stories mode ───────────────────────────────────────────────────────────
  function buildStories(container) {
    // Ensure container is visible — Shopify themes sometimes collapse bare divs
    container.style.display = 'block';
    container.style.width = '100%';
    container.style.minHeight = '96px';
    container.style.overflow = 'hidden';

    var row = document.createElement('div');
    row.id = '_btgv_stories';

    videos.forEach(function (video, i) {
      var story = document.createElement('div');
      story.className = '_btgv_story';

      var ring = document.createElement('div');
      ring.className = '_btgv_story_ring';

      var inner = document.createElement('div');
      inner.className = '_btgv_story_inner';

      var vid = document.createElement('video');
      vid.src = video.s3_url;
      vid.muted = true;
      vid.loop = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      inner.appendChild(vid);
      ring.appendChild(inner);

      var label = document.createElement('div');
      label.className = '_btgv_story_label';
      label.textContent = video.title || ('Video ' + (i + 1));

      story.appendChild(ring);
      story.appendChild(label);
      story.onclick = function () { buildFeed(i); };

      story.onmouseenter = function () { vid.play().catch(function () {}); };
      story.onmouseleave = function () { vid.pause(); vid.currentTime = 0; };

      row.appendChild(story);
    });

    container.appendChild(row);
  }

  // ─── Carousel mode ──────────────────────────────────────────────────────────
  function buildCarousel(container) {
    var row = document.createElement('div');
    row.id = '_btgv_carousel';

    videos.forEach(function (video, i) {
      var card = document.createElement('div');
      card.className = '_btgv_card';

      var vid = document.createElement('video');
      vid.src = video.s3_url;
      vid.muted = true;
      vid.loop = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      card.appendChild(vid);

      var overlay = document.createElement('div');
      overlay.className = '_btgv_card_overlay';

      var firstProduct = (video.video_product_tags || [])[0];
      if (firstProduct) {
        var nameEl = document.createElement('div');
        nameEl.className = '_btgv_card_name';
        nameEl.textContent = firstProduct.product_name;
        var priceEl = document.createElement('div');
        priceEl.className = '_btgv_card_price';
        priceEl.textContent = firstProduct.price ? '$' + parseFloat(firstProduct.price).toFixed(2) : '';
        overlay.appendChild(nameEl);
        overlay.appendChild(priceEl);
      }
      card.appendChild(overlay);

      card.onclick = function () { buildFeed(i); };
      card.onmouseenter = function () { vid.play().catch(function () {}); };
      card.onmouseleave = function () { vid.pause(); vid.currentTime = 0; };

      row.appendChild(card);
    });

    container.appendChild(row);
  }

  // ─── Feed-only mode ─────────────────────────────────────────────────────────
  function buildFeedButton(container) {
    var btn = document.createElement('button');
    btn.style.cssText = 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:12px;padding:12px 24px;font-size:15px;font-weight:700;cursor:pointer';
    btn.textContent = '🎬 Watch & Shop';
    btn.onclick = function () { buildFeed(0); };
    container.appendChild(btn);
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();

    // Find mount point or create one after the script tag
    var mountId = script.getAttribute('data-mount') || null;
    var container = mountId ? document.getElementById(mountId) : null;

    if (!container) {
      container = document.createElement('div');
      container.id = '_btgv_mount';
      script.parentNode.insertBefore(container, script.nextSibling);
    }

    fetchVideos(function () {
      if (!videos.length) return;

      if (MODE === 'stories') buildStories(container);
      else if (MODE === 'carousel') buildCarousel(container);
      else if (MODE === 'feed') buildFeedButton(container);
      else buildStories(container);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
