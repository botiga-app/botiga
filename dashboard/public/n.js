(()=>{var te=Object.defineProperty;var M=Object.getOwnPropertySymbols;var oe=Object.prototype.hasOwnProperty,ne=Object.prototype.propertyIsEnumerable;var R=(p,u,f)=>u in p?te(p,u,{enumerable:!0,configurable:!0,writable:!0,value:f}):p[u]=f,$=(p,u)=>{for(var f in u||(u={}))oe.call(u,f)&&R(p,f,u[f]);if(M)for(var f of M(u))ne.call(u,f)&&R(p,f,u[f]);return p};(function(){"use strict";let p=document.currentScript||document.querySelector('script[src*="/n.js"]')||document.querySelector("script[data-api]");if(!p)return;let u=(p.dataset.api||"https://api.botiga.ai").replace(/\/$/,"");console.log("[Botiga] widget init, API:",u);let f=(p.src?new URL(p.src).searchParams.get("k"):null)||p.dataset.k;if(!f)return;let H=p.dataset.color||null,D=p.dataset.label||null,N=p.dataset.position||null;function I(){let e="_botiga_sid",t=sessionStorage.getItem(e);return t||(t=btoa([Math.random().toString(36).slice(2),screen.width,screen.height,navigator.userAgent.length].join("|")).replace(/=/g,""),sessionStorage.setItem(e,t)),t}function O(){let e=["[data-add-to-cart]",".btn-cart","#add-to-cart",'[name="add"]',".product-form__cart-submit",".product-form__submit",'button[type="submit"].btn',".add-to-cart-btn",".btn-addtocart","#AddToCart",".shopify-payment-button__button"],t=null;for(let a of e)if(t=document.querySelector(a),t)break;if(t||(t=[...document.querySelectorAll("button")].find(r=>/cart|buy|add/i.test(r.textContent))),!t)return{backgroundColor:"#1a1a2e",color:"#ffffff",fontFamily:"system-ui,sans-serif",borderRadius:"6px",fontSize:"14px",padding:"12px 20px"};let o=window.getComputedStyle(t);return{backgroundColor:o.backgroundColor,color:o.color,fontFamily:o.fontFamily,borderRadius:o.borderRadius,fontSize:o.fontSize,padding:o.padding}}function U(){var a,r;let t=new URLSearchParams(window.location.search).get("variant");if(t)return t;try{let i=(r=(a=window.ShopifyAnalytics)==null?void 0:a.meta)==null?void 0:r.selectedVariantId;if(i)return String(i)}catch(i){}let o=document.querySelector('select[name="id"], input[name="id"]');return o!=null&&o.value?o.value:null}function W(){var o,a,r,i;let e=null,t=null;try{let n=(a=(o=window.ShopifyAnalytics)==null?void 0:o.meta)==null?void 0:a.product;if(n){e=n.title||null;let c=(r=n.variants)==null?void 0:r[0];c!=null&&c.price&&(t=c.price/100)}}catch(n){}if(!t)try{let n=(i=window.meta)==null?void 0:i.product;n&&(e=e||n.title,n.price&&(t=n.price/100))}catch(n){}if((!t||!e)&&(document.querySelector('#MainContent, main, [role="main"]')||document).querySelectorAll('script[type="application/ld+json"]').forEach(m=>{try{let s=JSON.parse(m.textContent),l=s["@type"]==="Product"?s:(s["@graph"]||[]).find(d=>d["@type"]==="Product");if(l&&(e||(e=l.name),!t)){let d=Array.isArray(l.offers)?l.offers[0]:l.offers;d!=null&&d.price&&(t=parseFloat(d.price))}}catch(s){}}),!e){let n=document.querySelector('meta[property="og:title"]');n&&(e=n.getAttribute("content"))}if(!t){let n=document.querySelector('meta[property="og:price:amount"]');n&&(t=parseFloat(n.getAttribute("content")))}return{name:e||document.title,price:t,url:window.location.href}}function z(e){let t=e||"below-cart";if(t==="below-cart"){let o=["[data-add-to-cart]",".btn-cart","#add-to-cart",'[name="add"]',".product-form__cart-submit",".add-to-cart-btn","#AddToCart"];for(let a of o){let r=document.querySelector(a);if(r)return r}}return t==="floating"?null:document.querySelector("form")||document.body}function J(e,t,o,a,r,i,n){return n?`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :host { display: block; }
        #btn {
          display: flex; align-items: center; gap: 10px;
          background: ${e}; color: ${t};
          font-family: ${o||"system-ui, sans-serif"};
          font-size: 14px; font-weight: 600;
          padding: 14px 20px; border: none; border-radius: 50px;
          cursor: pointer; white-space: nowrap;
          box-shadow: 0 4px 20px rgba(0,0,0,0.25);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        #btn:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
        .attr { font-size: 9px; color: #aaa; text-align: center; margin-top: 4px; font-family: system-ui,sans-serif; }
      `:`
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :host { display: block; width: 100%; margin-top: 8px; }
      #btn {
        width: 100%; cursor: pointer; border: 1.5px solid ${e};
        background: transparent; color: ${e};
        font-family: ${o||"system-ui, sans-serif"};
        font-size: ${r||"14px"};
        border-radius: ${a||"6px"};
        padding: ${i||"12px 20px"};
        display: flex; align-items: center; justify-content: center; gap: 6px;
        font-weight: 500; transition: all 0.15s; line-height: 1.4;
      }
      #btn:hover { background: ${e}; color: ${t}; }
      .attr { font-size: 9px; color: #aaa; text-align: center; margin-top: 4px; font-family: system-ui,sans-serif; }
    `}function V(e,t,o,a){return`
      * { box-sizing: border-box; margin: 0; padding: 0; }
      #overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.45);
        z-index: 2147483646; display: flex; align-items: flex-end; justify-content: center;
      }
      #panel {
        background: #fff; border-radius: 16px 16px 0 0;
        width: 100%; max-width: 420px; height: 520px;
        display: flex; flex-direction: column;
        font-family: ${o}; overflow: hidden;
        box-shadow: 0 -8px 40px rgba(0,0,0,0.18);
      }
      .hdr {
        padding: 16px 20px; background: ${e}; color: ${t};
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
      .msg.user { background: ${e}; color: ${t}; border-radius: 14px 14px 2px 14px; align-self: flex-end; }
      .typing { font-size: 12px; color: #999; align-self: flex-start; padding: 6px 0; }
      .input-row { display: flex; padding: 12px 16px; gap: 8px; border-top: 1px solid #eee; background: #fff; }
      .inp { flex: 1; border: 1.5px solid #ddd; border-radius: 20px; padding: 10px 16px; font-size: 13px; font-family: inherit; outline: none; transition: border 0.15s; }
      .inp:focus { border-color: ${e}; }
      .send { background: ${e}; color: ${t}; border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
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
    `}function Y(e,t,o){let a=document.getElementById("_botiga_chat_host");if(a){a.remove();return}let r=document.createElement("div");r.id="_botiga_chat_host";let i=r.attachShadow({mode:"closed"}),n=document.createElement("style"),c=t.backgroundColor,m=t.color||"#fff";n.textContent=V(c,m,t.fontFamily,t.borderRadius),i.appendChild(n);let s=document.createElement("div");s.id="overlay",s.innerHTML=`
      <div id="panel">
        <div class="hdr">
          <div>
            <h3>&#128172; Make an offer</h3>
            <p>${k(o.name||"")}</p>
          </div>
          <button class="close-btn" id="close-btn">&#x2715;</button>
        </div>
        <div class="msgs" id="msgs">
          <div class="msg bot">Hey! I see you're interested in <strong>${k(o.name||"this item")}</strong>${o.price?` (listed at <strong>$${o.price}</strong>)`:""}. What offer did you have in mind? &#128522;</div>
        </div>
        <div class="input-row" id="input-row">
          <input class="inp" id="inp" type="text" placeholder="Type your offer..." autocomplete="off" />
          <button class="send" id="send-btn">&#10148;</button>
        </div>
      </div>
    `,i.appendChild(s),document.body.appendChild(r);let l=null,d=!1,b=i.querySelector("#msgs"),w=i.querySelector("#inp"),T=i.querySelector("#send-btn");i.querySelector("#close-btn").addEventListener("click",()=>r.remove()),s.addEventListener("click",g=>{g.target===s&&r.remove()}),w.addEventListener("keydown",g=>{g.key==="Enter"&&P()}),T.addEventListener("click",P),setTimeout(()=>w.focus(),80);function v(g,h){var y;(y=i.querySelector(".typing"))==null||y.remove();let x=document.createElement("div");x.className=`msg ${g}`,x.textContent=h,b.appendChild(x),b.scrollTop=b.scrollHeight}function L(g){if(d=g,T.disabled=g,g){let h=document.createElement("div");h.className="typing",h.textContent="typing...",b.appendChild(h),b.scrollTop=b.scrollHeight}}function Q(g,h,x,y){var j;(j=i.querySelector("#input-row"))==null||j.remove();let S=document.createElement("div");S.className="deal-banner";let X=y?new Date(y):new Date(Date.now()+72e5);S.innerHTML=`
        <div class="deal-title">&#127881; Deal locked in!</div>
        <div>
          <span class="deal-price">$${parseFloat(g).toFixed(2)}</span>
          ${h?`<span class="deal-orig">$${parseFloat(h).toFixed(2)}</span>`:""}
        </div>
        <div class="deal-timer" id="ctdn">Expires in: ...</div>
        <a href="${x}" class="checkout-btn" target="_top">Complete Purchase &#8594;</a>
      `,i.querySelector("#panel").appendChild(S);let A=i.querySelector("#ctdn"),B=()=>{let _=X-Date.now();if(_<=0){A.textContent="Deal expired";return}let F=Math.floor(_/36e5),Z=Math.floor(_%36e5/6e4),ee=Math.floor(_%6e4/1e3);A.textContent=`Expires in: ${F>0?F+"h ":""}${Z}m ${ee}s`,setTimeout(B,1e3)};B()}async function P(){let g=w.value.trim();if(!(!g||d)){w.value="",v("user",g),L(!0);try{let x=await(await fetch(`${u}/api/negotiate`,{method:"POST",headers:$({"Content-Type":"application/json"},C),body:JSON.stringify({api_key:f,session_id:I(),negotiation_id:l,product_name:o.name,product_url:o.url,variant_id:U(),list_price:o.price||0,customer_message:g})})).json();if(x.error){v("bot","Sorry, having trouble right now. Try again!");return}l=x.negotiation_id,v("bot",x.bot_reply),x.status==="won"&&x.deal_price&&Q(x.deal_price,o.price,x.checkout_url,x.expires_at)}catch(h){v("bot","Connection issue \u2014 please try again.")}finally{L(!1)}}}return()=>l}function k(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function K(e,t,o,a,r){let i=document.createElement("div");i.id="_botiga_btn_host";let n=i.attachShadow({mode:"closed"}),c=H||e.button_color||t.backgroundColor,m=e.button_text_color||t.color||"#fff",s=D||e.button_label||"Make an offer",l=document.createElement("style");l.textContent=J(c,m,t.fontFamily,t.borderRadius,t.fontSize,t.padding,r),n.appendChild(l);let d=document.createElement("button");if(d.id="btn",d.innerHTML=`&#10024; ${k(s)}`,n.appendChild(d),e.plan!=="white_label"){let b=document.createElement("div");b.className="attr",b.textContent="Powered by botiga.ai",n.appendChild(b)}return d.addEventListener("click",()=>{let b=Y(e,{backgroundColor:c,color:m,fontFamily:t.fontFamily,borderRadius:t.borderRadius},o);b&&(a=b)}),i}function G(e,t){let o=!1;document.addEventListener("mouseleave",a=>{if(a.clientY<=0&&!o){let r=t();if(!r)return;o=!0;let i=document.createElement("div");i.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483647;display:flex;align-items:center;justify-content:center;";let n=document.createElement("div");n.style.cssText="background:#fff;border-radius:16px;padding:28px;width:340px;font-family:system-ui,sans-serif;",n.innerHTML=`
          <h3 style="font-size:17px;font-weight:700;margin-bottom:6px;">Wait \u2014 hold your deal! &#129309;</h3>
          <p style="font-size:13px;color:#666;margin-bottom:16px;">Leave your details and we'll send you the deal to complete later.</p>
          <input id="_bex_phone" type="tel" placeholder="WhatsApp (e.g. +1234567890)" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:10px;display:block;" />
          <input id="_bex_email" type="email" placeholder="Or your email" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:10px;display:block;" />
          <button id="_bex_save" style="width:100%;padding:12px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Save my deal</button>
          <button id="_bex_skip" style="display:block;width:100%;text-align:center;margin-top:10px;font-size:12px;color:#999;cursor:pointer;background:none;border:none;">No thanks</button>
        `,i.appendChild(n),document.body.appendChild(i);let c=()=>i.remove();n.querySelector("#_bex_skip").addEventListener("click",c),i.addEventListener("click",m=>{m.target===i&&c()}),n.querySelector("#_bex_save").addEventListener("click",async()=>{let m=n.querySelector("#_bex_phone").value.trim(),s=n.querySelector("#_bex_email").value.trim();if(!(!m&&!s)){try{await fetch(`${u}/api/recovery/capture`,{method:"POST",headers:$({"Content-Type":"application/json"},C),body:JSON.stringify({negotiation_id:r,customer_whatsapp:m||null,customer_email:s||null})})}catch(l){}n.innerHTML=`<p style="font-size:14px;color:#047857;text-align:center;padding:20px 0;">&#9989; Deal saved! We'll send it to you.</p>`,setTimeout(c,2e3)}})}})}function E(e){let t=e.negotiate_on_product,o=e.negotiate_on_cart,r=window.location.pathname.includes("/cart");if(console.log("[Botiga] init \u2014 isProductPage:",t,"isCart:",r),!t&&!r){console.log("[Botiga] not a product or cart page, skipping");return}if(r&&!o){console.log("[Botiga] cart page disabled, skipping");return}let i=O(),n=W();console.log("[Botiga] placement target:",z(e.button_position||"below-cart"));let c=()=>null,m=N||e.button_position||"below-cart",s=m==="floating",l=z(m),d=K(e,i,n,c,s);s?(d.style.cssText="position:fixed;bottom:24px;right:24px;z-index:2147483645;",document.body.appendChild(d)):l?l.parentNode.insertBefore(d,l.nextSibling):document.body.appendChild(d),e.recovery_enabled&&G(e,c)}let C={"ngrok-skip-browser-warning":"1"};function q(){console.log("[Botiga] fetching settings for key:",f),fetch(`${u}/api/widget/settings?k=${encodeURIComponent(f)}`,{headers:C}).then(e=>e.json()).then(e=>{if(console.log("[Botiga] settings received:",e),e.error){console.log("[Botiga] settings error, aborting");return}e.dwell_time_seconds>0?(console.log("[Botiga] waiting",e.dwell_time_seconds,"s before inject"),setTimeout(()=>E(e),e.dwell_time_seconds*1e3)):(console.log("[Botiga] injecting immediately"),E(e))}).catch(e=>{console.log("[Botiga] settings fetch failed:",e)})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",q):q()})();})();
