/* Botiga confetti — injected as Shopify Script Tag, runs in main document */
(function () {
  'use strict';

  function burst() {
    try {
      var cv = document.createElement('canvas');
      cv.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;';
      document.documentElement.appendChild(cv);
      cv.width = window.innerWidth;
      cv.height = window.innerHeight;
      var ctx = cv.getContext('2d');
      var cols = ['#FFD700','#FF4444','#4ECDC4','#FF8E53','#a78bfa','#34d399','#60a5fa','#f472b6','#fff176','#fb923c'];
      var pieces = [];
      for (var i = 0; i < 280; i++) {
        var isRect = Math.random() > 0.4;
        pieces.push({
          x: Math.random() * cv.width,
          y: -20 - Math.random() * 300,
          w: isRect ? Math.random() * 14 + 5 : Math.random() * 10 + 5,
          h: isRect ? Math.random() * 7 + 3 : Math.random() * 10 + 5,
          isRect: isRect,
          color: cols[Math.floor(Math.random() * cols.length)],
          vx: (Math.random() - 0.5) * 7,
          vy: Math.random() * 4 + 2,
          rot: Math.random() * Math.PI * 2,
          vrot: (Math.random() - 0.5) * 0.22,
          op: 1
        });
      }
      var t0 = Date.now();
      function draw() {
        ctx.clearRect(0, 0, cv.width, cv.height);
        var elapsed = Date.now() - t0;
        var alive = false;
        for (var i = 0; i < pieces.length; i++) {
          var p = pieces[i];
          p.x += p.vx; p.y += p.vy; p.vy += 0.13; p.rot += p.vrot;
          if (elapsed > 2800) p.op = Math.max(0, p.op - 0.018);
          if (p.op > 0) alive = true;
          ctx.save();
          ctx.globalAlpha = p.op;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          if (p.isRect) {
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
        if (alive && elapsed < 5500) {
          requestAnimationFrame(draw);
        } else {
          cv.remove();
        }
      }
      requestAnimationFrame(draw);
    } catch (e) {}
  }

  document.addEventListener('botiga:deal', burst);
})();
