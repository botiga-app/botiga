(()=>{var Ee=Object.defineProperty,qe=Object.defineProperties;var Te=Object.getOwnPropertyDescriptors;var X=Object.getOwnPropertySymbols;var Me=Object.prototype.hasOwnProperty,Le=Object.prototype.propertyIsEnumerable;var Z=(p,f,m)=>f in p?Ee(p,f,{enumerable:!0,configurable:!0,writable:!0,value:m}):p[f]=m,T=(p,f)=>{for(var m in f||(f={}))Me.call(f,m)&&Z(p,m,f[m]);if(X)for(var m of X(f))Le.call(f,m)&&Z(p,m,f[m]);return p},U=(p,f)=>qe(p,Te(f));(function(){"use strict";let p=document.currentScript||document.querySelector('script[src*="/n.js"]')||document.querySelector("script[data-api]");if(!p)return;let f=(p.dataset.api||"https://api.botiga.ai").replace(/\/$/,""),m=(p.src?new URL(p.src).searchParams.get("k"):null)||p.dataset.k;if(!m)return;let ee=p.dataset.color||null,te=p.dataset.label||null,ne=p.dataset.position||null,N={"ngrok-skip-browser-warning":"1"},P="_botiga_session";function I(){try{let e=sessionStorage.getItem(P);if(!e)return{};let t=JSON.parse(e);return t.ts&&Date.now()-t.ts>2*60*60*1e3?(sessionStorage.removeItem(P),{}):t}catch(e){return{}}}function R(e){let t=I();sessionStorage.setItem(P,JSON.stringify(U(T(T({},t),e),{ts:Date.now()})))}function oe(){sessionStorage.removeItem(P)}function Y(){let e=I();return e.sid||(e.sid=btoa([Math.random().toString(36).slice(2),screen.width,screen.height,navigator.userAgent.length].join("|")).replace(/=/g,""),R({sid:e.sid})),e.sid}function ie(){let e=["[data-add-to-cart]",".btn-cart","#add-to-cart",'[name="add"]',".product-form__cart-submit",".product-form__submit",'button[type="submit"].btn',".add-to-cart-btn",".btn-addtocart","#AddToCart",".shopify-payment-button__button"],t=null;for(let d of e)if(t=document.querySelector(d),t)break;if(t||(t=[...document.querySelectorAll("button")].find(d=>/cart|buy|add/i.test(d.textContent))),!t)return{backgroundColor:"#1a1a2e",color:"#ffffff",fontFamily:"system-ui,sans-serif",borderRadius:"6px",fontSize:"14px",padding:"12px 20px"};let o=window.getComputedStyle(t);return{backgroundColor:o.backgroundColor,color:o.color,fontFamily:o.fontFamily,borderRadius:o.borderRadius,fontSize:o.fontSize,padding:o.padding}}function B(){var o,d;let e=new URLSearchParams(window.location.search).get("variant");if(e)return e;try{let r=(d=(o=window.ShopifyAnalytics)==null?void 0:o.meta)==null?void 0:d.selectedVariantId;if(r)return String(r)}catch(r){}let t=document.querySelector('select[name="id"], input[name="id"]');return t!=null&&t.value?t.value:null}function re(){var o,d,r;let e=null,t=null;try{let n=(d=(o=window.ShopifyAnalytics)==null?void 0:o.meta)==null?void 0:d.product;if(n){e=n.title||null;let a=(r=n.variants)==null?void 0:r[0];a!=null&&a.price&&(t=a.price/100)}}catch(n){}if((!t||!e)&&(document.querySelector("#MainContent, main")||document).querySelectorAll('script[type="application/ld+json"]').forEach(n=>{try{let a=JSON.parse(n.textContent),c=a["@type"]==="Product"?a:(a["@graph"]||[]).find(u=>u["@type"]==="Product");if(c&&(e||(e=c.name),!t)){let u=Array.isArray(c.offers)?c.offers[0]:c.offers;u!=null&&u.price&&(t=parseFloat(u.price))}}catch(a){}}),!e){let n=document.querySelector('meta[property="og:title"]');n&&(e=n.getAttribute("content"))}if(!t){let n=document.querySelector('meta[property="og:price:amount"]');n&&(t=parseFloat(n.getAttribute("content")))}return{name:e||document.title,price:t,url:window.location.href}}function ae(e){if((e||"below-cart")==="below-cart")for(let t of["[data-add-to-cart]",".btn-cart","#add-to-cart",'[name="add"]',".product-form__cart-submit",".add-to-cart-btn","#AddToCart"]){let o=document.querySelector(t);if(o)return o}return e==="floating"?null:document.querySelector("form")||document.body}function F(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function se(e,t,o,d,r,n,a){return a?`
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :host { display: block; }
      #btn { display: flex; align-items: center; gap: 10px; background: ${e}; color: ${t};
        font-family: ${o||"system-ui, sans-serif"}; font-size: 14px; font-weight: 600;
        padding: 14px 20px; border: none; border-radius: 50px; cursor: pointer; white-space: nowrap;
        box-shadow: 0 4px 20px rgba(0,0,0,0.25); transition: transform 0.15s, box-shadow 0.15s; }
      #btn:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
      .attr { font-size: 9px; color: #aaa; text-align: center; margin-top: 4px; font-family: system-ui,sans-serif; }
    `:`
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :host { display: block; width: 100%; margin-top: 8px; }
      #btn { width: 100%; cursor: pointer; border: 1.5px solid ${e}; background: transparent; color: ${e};
        font-family: ${o||"system-ui, sans-serif"}; font-size: ${r||"14px"};
        border-radius: ${d||"6px"}; padding: ${n||"12px 20px"};
        display: flex; align-items: center; justify-content: center; gap: 6px;
        font-weight: 500; transition: all 0.15s; line-height: 1.4; }
      #btn:hover { background: ${e}; color: ${t}; }
      .attr { font-size: 9px; color: #aaa; text-align: center; margin-top: 4px; font-family: system-ui,sans-serif; }
    `}function de(e,t,o){return`
      * { box-sizing: border-box; margin: 0; padding: 0; }
      #overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 2147483646; display: flex; align-items: flex-end; justify-content: center; }
      #panel { background: #fff; border-radius: 16px 16px 0 0; width: 100%; max-width: 420px; height: 580px;
        display: flex; flex-direction: column; font-family: ${o}; overflow: hidden; box-shadow: 0 -8px 40px rgba(0,0,0,0.18); position: relative; }
      .hdr { padding: 16px 20px; background: ${e}; color: ${t}; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
      .hdr h3 { font-size: 15px; font-weight: 600; }
      .hdr p { font-size: 11px; opacity: 0.8; margin-top: 2px; }
      .close-btn { background: none; border: none; color: inherit; cursor: pointer; font-size: 20px; padding: 0 4px; }
      .msgs { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f7f7f8; }
      .msg { max-width: 85%; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.5; }
      .msg.bot { background: #fff; color: #1a1a1a; border-radius: 14px 14px 14px 2px; align-self: flex-start; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
      .msg.user { background: ${e}; color: ${t}; border-radius: 14px 14px 2px 14px; align-self: flex-end; }
      .typing { display: flex; align-items: center; gap: 4px; align-self: flex-start; padding: 10px 14px; background: #fff; border-radius: 14px 14px 14px 2px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
      .typing span { width: 6px; height: 6px; background: #bbb; border-radius: 50%; animation: bounce 1.2s infinite; }
      .typing span:nth-child(2) { animation-delay: 0.2s; }
      .typing span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
      .reaction { font-size: 12px; color: #6b7280; align-self: flex-end; padding: 2px 4px; animation: fadein 0.2s ease; }
      @keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      .input-row { display: flex; padding: 12px 16px; gap: 8px; border-top: 1px solid #eee; background: #fff; flex-shrink: 0; }
      .inp { flex: 1; border: 1.5px solid #ddd; border-radius: 20px; padding: 10px 16px; font-size: 13px; font-family: inherit; outline: none; transition: border 0.15s; }
      .inp:focus { border-color: ${e}; }
      .send { background: ${e}; color: ${t}; border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
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
    `}function ce(e,t,o){let d=document.getElementById("_botiga_chat_host");if(d){d.remove();return}let r=document.createElement("div");r.id="_botiga_chat_host";let n=r.attachShadow({mode:"closed"}),a=t.backgroundColor,c=t.color||"#fff",u=document.createElement("style");u.textContent=de(a,c,t.fontFamily),n.appendChild(u);let v=document.createElement("div");v.id="overlay",v.innerHTML=`
      <div id="panel">
        <div class="hdr">
          <div><h3>&#128172; Make an offer</h3><p>${F(o.name||"")}</p></div>
          <button class="close-btn" id="close-btn">&#x2715;</button>
        </div>
        <div class="msgs" id="msgs"></div>
        <div class="input-row" id="input-row">
          <input class="inp" id="inp" type="text" placeholder="Type your offer or reply..." autocomplete="off" />
          <button class="send" id="send-btn" disabled>&#10148;</button>
        </div>
      </div>
    `,n.appendChild(v),document.body.appendChild(r);let y=null,M=!1,_=!1,k=n.querySelector("#msgs"),z=n.querySelector("#inp"),H=n.querySelector("#send-btn");n.querySelector("#close-btn").addEventListener("click",()=>r.remove()),v.addEventListener("click",i=>{i.target===v&&r.remove()}),z.addEventListener("keydown",i=>{i.key==="Enter"&&!H.disabled&&G()}),H.addEventListener("click",G);function C(i,s){E();let g=document.createElement("div");return g.className=`msg ${i}`,g.textContent=s,k.appendChild(g),k.scrollTop=k.scrollHeight,g}function W(){E();let i=document.createElement("div");i.className="typing",i.id="_typing",i.innerHTML="<span></span><span></span><span></span>",k.appendChild(i),k.scrollTop=k.scrollHeight}function E(){var i,s;(i=n.querySelector("#_typing"))==null||i.remove(),(s=n.querySelector(".reaction"))==null||s.remove()}function O(i){M=i,H.disabled=i,z.disabled=i}function ue(i){if(!o.price)return;let s=i.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/);if(!s)return;let g=parseFloat(s[1].replace(/[,\s]/g,""));if(g<=0)return;let x=g/o.price,q,h;x>=.9?(q="\u{1F929}",h="Getting warmer..."):x>=.8?(q="\u{1F60A}",h="Not bad..."):(q="\u{1F62C}",h="That's a tough one...");let $=document.createElement("div");$.className="reaction",$.textContent=`${q} ${h}`,k.appendChild($),k.scrollTop=k.scrollHeight}function me(i){if(!o.price)return 1500;let s=i.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/);return s&&parseFloat(s[1].replace(/[,\s]/g,""))/o.price<.7?2500:1500}function ge(i,s,g,x){var V;if(_)return;_=!0,(V=n.querySelector("#input-row"))==null||V.remove();let q=n.querySelector("#panel"),h=o.price||i,$=Math.round(h-i),be=Math.round($/h*100),ye=g?new Date(g):new Date(Date.now()+10*60*1e3),L=document.createElement("div");L.className="deal-screen",L.innerHTML=`
        <svg class="deal-check" viewBox="0 0 52 52" width="52" height="52">
          <circle cx="26" cy="26" r="24" fill="none" stroke="#1a472a" stroke-width="2"/>
          <path class="checkmark" fill="none" stroke="white" stroke-width="3"
            stroke-linecap="round" stroke-linejoin="round"
            d="M14 27l8 8 16-16"
            stroke-dasharray="36" stroke-dashoffset="36"/>
        </svg>
        <div class="deal-product">${F(o.name||"")}</div>
        <div class="deal-orig-num">${h!==i?"$"+Math.round(h):""}</div>
        <div class="deal-price-wrap">
          <div class="deal-price-num" id="_dp">$${Math.round(h)}</div>
        </div>
        <div class="deal-savings" id="_ds">${$>0?"You saved $"+$+" &middot; "+be+"% off":"Deal locked in"}</div>
        ${x?`<div class="deal-code-line">${F(x)} applied automatically</div>`:""}
        <div class="deal-timer-wrap">
          <div class="deal-timer-digits" id="_dtd">10:00</div>
          <div class="deal-timer-label">Deal expires in</div>
        </div>
        <div class="deal-redirect-label" id="_drl" style="opacity:0">Heading to your cart...</div>
        <button class="deal-fallback" id="_dfb">Go to cart &rarr;</button>
        <div class="deal-progress" id="_dpr"></div>
      `,q.appendChild(L),requestAnimationFrame(()=>{L.classList.add("visible")}),setTimeout(()=>{he(Math.round(h),Math.round(i),700,()=>{let l=n.querySelector("#_ds");l&&l.classList.add("show")})},500);function he(l,b,w,S){let ve=performance.now(),_e=l-b;function Q(ke){let Se=ke-ve,A=Math.min(Se/w,1),Ce=1-Math.pow(1-A,3),$e=A>.85&&A<1?Math.sin((A-.85)/.15*Math.PI)*2:0,ze=Math.round(l-_e*Ce+$e),D=n.querySelector("#_dp");D&&(D.textContent="$"+ze),A<1?requestAnimationFrame(Q):(D&&(D.textContent="$"+b),S&&S())}requestAnimationFrame(Q)}setTimeout(()=>{let l=document.createElement("script");l.src="https://cdnjs.cloudflare.com/ajax/libs/canvas-confetti/1.6.0/confetti.browser.min.js",document.head.appendChild(l),l.onload=()=>{let b=document.createElement("canvas");b.style.cssText="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;",L.appendChild(b);let w=window.confetti.create(b,{resize:!0}),S=["#1a472a","#2d6a4f","#d4b896","#f9f7f4","#c4a882"];w({particleCount:60,spread:55,origin:{x:.2,y:.5},colors:S}),w({particleCount:60,spread:55,origin:{x:.8,y:.5},colors:S})}},700);let j=n.querySelector("#_dtd"),we=setInterval(()=>{let l=Math.max(0,ye-Date.now()),b=Math.floor(l/6e4),w=Math.floor(l%6e4/1e3);if(j&&(j.textContent=String(b).padStart(2,"0")+":"+String(w).padStart(2,"0"),l<12e4&&j.classList.add("urgent")),l<=0){clearInterval(we),j&&(j.textContent="Expired");let S=n.querySelector("#_dfb");S&&(S.style.display="block",S.onclick=()=>{s&&(window.location.href=s)})}},1e3);setTimeout(()=>{let l=n.querySelector("#_drl");l&&(l.style.opacity="1")},1500),setTimeout(()=>{let l=n.querySelector("#_dpr");l&&(l.style.width="100%"),setTimeout(()=>{if(s)try{window.location.href=s}catch(b){let w=n.querySelector("#_dfb");w&&(w.style.display="block",w.onclick=()=>{window.location.href=s})}else{let b=n.querySelector("#_dfb");b&&(b.style.display="block",b.onclick=()=>window.history.back())}},500)},2500);let K=n.querySelector("#_dfb");K&&(K.onclick=()=>{s&&(window.location.href=s)})}async function xe(){W(),await new Promise(i=>setTimeout(i,1200));try{let s=await(await fetch(`${f}/api/negotiate`,{method:"POST",headers:T({"Content-Type":"application/json"},N),body:JSON.stringify({api_key:m,session_id:Y(),product_name:o.name,product_url:o.url,variant_id:B(),list_price:o.price||0,opening:!0})})).json();E(),s.error?C("bot","Hey! Let's see if we can make a deal. What's your offer?"):(y=s.negotiation_id,R({negotiationId:y}),C("bot",s.bot_reply))}catch(i){E(),C("bot","Hey! What offer did you have in mind? \u{1F60A}")}O(!1),H.disabled=!1,z.disabled=!1,setTimeout(()=>z.focus(),80)}async function G(){let i=z.value.trim();if(!i||M)return;z.value="",C("user",i),ue(i);let s=me(i);O(!0),await new Promise(g=>setTimeout(g,s)),W();try{let x=await(await fetch(`${f}/api/negotiate`,{method:"POST",headers:T({"Content-Type":"application/json"},N),body:JSON.stringify({api_key:m,session_id:Y(),negotiation_id:y,product_name:o.name,product_url:o.url,variant_id:B(),list_price:o.price||0,customer_message:i})})).json();if(E(),x.error){C("bot","Sorry, having trouble \u2014 try again in a moment.");return}y=x.negotiation_id,R({negotiationId:y}),C("bot",x.bot_reply),x.status==="won"&&x.deal_price&&(ge(x.deal_price,x.checkout_url,x.expires_at,x.discount_code),oe())}catch(g){E(),C("bot","Connection issue \u2014 please try again.")}finally{O(!1)}}return O(!0),xe(),()=>y}function le(e,t,o,d){let r=document.createElement("div");r.id="_botiga_btn_host";let n=r.attachShadow({mode:"closed"}),a=ee||e.button_color||t.backgroundColor,c=e.button_text_color||t.color||"#fff",u=te||e.button_label||"Make an offer",v=document.createElement("style");v.textContent=se(a,c,t.fontFamily,t.borderRadius,t.fontSize,t.padding,d),n.appendChild(v);let y=document.createElement("button");if(y.id="btn",y.innerHTML=`&#10024; ${F(u)}`,n.appendChild(y),e.plan!=="white_label"){let _=document.createElement("div");_.className="attr",_.textContent="Powered by botiga.ai",n.appendChild(_)}let M=()=>null;return y.addEventListener("click",()=>{let _=ce(e,{backgroundColor:a,color:c,fontFamily:t.fontFamily,borderRadius:t.borderRadius},o);_&&(M=_)}),{host:r,getNegId:()=>M()}}function pe(e){let t=!1;document.addEventListener("mouseleave",o=>{if(o.clientY>0||t)return;let d=e();if(!d)return;t=!0;let r=document.createElement("div");r.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483647;display:flex;align-items:center;justify-content:center;";let n=document.createElement("div");n.style.cssText="background:#fff;border-radius:16px;padding:28px;width:340px;font-family:system-ui,sans-serif;",n.innerHTML=`
        <h3 style="font-size:17px;font-weight:700;margin-bottom:6px;">Wait \u2014 hold your deal! &#129309;</h3>
        <p style="font-size:13px;color:#666;margin-bottom:16px;">Leave your details and we'll send you the deal to complete later.</p>
        <input id="_bex_phone" type="tel" placeholder="WhatsApp (e.g. +1234567890)" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:10px;display:block;box-sizing:border-box;" />
        <input id="_bex_email" type="email" placeholder="Or your email" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:10px;display:block;box-sizing:border-box;" />
        <button id="_bex_save" style="width:100%;padding:12px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Save my deal</button>
        <button id="_bex_skip" style="display:block;width:100%;text-align:center;margin-top:10px;font-size:12px;color:#999;cursor:pointer;background:none;border:none;">No thanks</button>
      `,r.appendChild(n),document.body.appendChild(r);let a=()=>r.remove();n.querySelector("#_bex_skip").addEventListener("click",a),r.addEventListener("click",c=>{c.target===r&&a()}),n.querySelector("#_bex_save").addEventListener("click",async()=>{let c=n.querySelector("#_bex_phone").value.trim(),u=n.querySelector("#_bex_email").value.trim();if(!(!c&&!u)){try{await fetch(`${f}/api/recovery/capture`,{method:"POST",headers:T({"Content-Type":"application/json"},N),body:JSON.stringify({negotiation_id:d,customer_whatsapp:c||null,customer_email:u||null})})}catch(v){}n.innerHTML=`<p style="font-size:14px;color:#047857;text-align:center;padding:20px 0;">&#9989; Deal saved! We'll send it to you.</p>`,setTimeout(a,2e3)}})})}function fe(e){let t=window.location.pathname.includes("/cart");if(!e.negotiate_on_product&&!t||t&&!e.negotiate_on_cart)return;let o=ie(),d=re(),r=ne||e.button_position||"below-cart",n=r==="floating",a=ae(r),{host:c,getNegId:u}=le(e,o,d,n);n?(c.style.cssText="position:fixed;bottom:24px;right:24px;z-index:2147483645;",document.body.appendChild(c)):a?a.parentNode.insertBefore(c,a.nextSibling):document.body.appendChild(c),e.recovery_enabled&&pe(u)}function J(){fetch(`${f}/api/widget/settings?k=${encodeURIComponent(m)}`,{headers:N}).then(e=>e.json()).then(e=>{e.error||fe(e)}).catch(()=>{})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",J):J()})();})();
