'use client';
import { useState } from 'react';
import ProductRuleEditor from './ProductRuleEditor';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';

// One tagged product on a video. Three visible states:
//   1. auto_tagged — ✨ AI badge, neutral white background
//   2. pending_review — amber background, "Review" badge, ✓ Accept / Reject buttons
//   3. manual — neutral, no AI badge
//
// Click ↗ "Edit in Shopify" / "View on store" / "Rules" expand toggle.
// Used by both the grid drawer (/dashboard/videos) and the vertical
// scroll editor (/dashboard/videos/preview) so the experience is
// identical in both surfaces.
//
// Props:
//   tag           — { id, product_name, image_url, price, compare_at_price,
//                     match_status, match_score, shopify_product_id, product_handle }
//   videoId       — UUID
//   merchantId    — UUID
//   shopifyDomain — e.g. "shopwhb.myshopify.com" (drives admin/storefront links)
//   onRemoved     — () => void after successful delete
//   onUpdated     — (updatedTag) => void after Accept (status flips to auto_tagged)
export default function TagRow({ tag, videoId, merchantId, shopifyDomain, onRemoved, onUpdated }) {
  const [busy, setBusy] = useState(null);            // null | 'accepting' | 'removing'
  const [showRules, setShowRules] = useState(false);
  const [justAccepted, setJustAccepted] = useState(false);
  const [actionError, setActionError] = useState(null);

  async function remove() {
    if (busy) return;
    setBusy('removing');
    setActionError(null);
    try {
      const r = await fetch(`${API}/api/videos/${videoId}/tags/${tag.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      onRemoved && onRemoved();
    } catch (err) {
      setActionError(err.message || 'Failed to remove');
      setBusy(null);
    }
  }

  async function accept() {
    if (busy) return;
    setBusy('accepting');
    setActionError(null);
    try {
      const r = await fetch(`${API}/api/videos/${videoId}/tags/${tag.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_status: 'auto_tagged' }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${r.status}`);
      }
      const updated = await r.json();
      // Brief green-flash so the merchant SEES the change before the row
      // morphs to its confirmed (white background, AI badge) state
      setJustAccepted(true);
      setTimeout(() => {
        setJustAccepted(false);
        onUpdated && onUpdated(updated);
      }, 900);
    } catch (err) {
      setActionError(err.message || 'Failed to accept');
    } finally {
      setBusy(null);
    }
  }

  const isPending = tag.match_status === 'pending_review';

  return (
    <div className={`rounded-lg border transition-all ${
      busy === 'removing' ? 'opacity-40' : ''
    } ${
      justAccepted
        ? 'bg-emerald-50 border-emerald-300 shadow-md shadow-emerald-100'
        : isPending
        ? 'bg-amber-50/40 border-amber-200'
        : 'bg-white border-gray-200'
    }`}>
      <div className="flex items-start gap-3 p-2.5">
        {tag.image_url ? (
          <img src={tag.image_url} alt="" className="w-12 h-12 rounded-md object-cover bg-gray-100 flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-md bg-gray-100 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-gray-900 truncate">{tag.product_name}</span>
            {tag.match_status === 'auto_tagged' && (
              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold flex-shrink-0">AI</span>
            )}
            {isPending && (
              <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold flex-shrink-0">Review</span>
            )}
          </div>
          <div className="text-xs text-gray-600 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {tag.price != null && <span className="font-medium">${tag.price}</span>}
            {tag.compare_at_price != null && tag.compare_at_price > (tag.price ?? 0) && (
              <span className="text-gray-400 line-through">${tag.compare_at_price}</span>
            )}
            {tag.match_score != null && (
              <span className="text-gray-500">· {Math.round(tag.match_score * 100)}% match</span>
            )}
            {tag.product_handle && (
              <span className="text-gray-400">· {tag.product_handle}</span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {shopifyDomain && tag.shopify_product_id && (
              <a
                href={`https://${shopifyDomain}/admin/products/${tag.shopify_product_id}`}
                target="_blank" rel="noreferrer"
                className="text-[11px] font-medium px-2 py-0.5 rounded bg-gray-900 text-white hover:bg-gray-800 transition-colors"
                title="Open in Shopify admin">
                Edit in Shopify ↗
              </a>
            )}
            {tag.product_handle && shopifyDomain && (
              <a
                href={`https://${shopifyDomain.replace('.myshopify.com', '')}.myshopify.com/products/${tag.product_handle}`}
                target="_blank" rel="noreferrer"
                className="text-[11px] font-medium px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                title="Open product on storefront">
                View on store ↗
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {!isPending && tag.product_handle && merchantId && (
            <button
              onClick={() => setShowRules(s => !s)}
              className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${
                showRules ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
              }`}
              title="Negotiation rule for this product"
            >
              {showRules ? '▾ Rules' : 'Rules'}
            </button>
          )}
          <button
            onClick={remove}
            disabled={!!busy}
            className="text-gray-400 hover:text-red-600 text-sm w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center transition-colors"
            aria-label="Remove tag"
          >×</button>
        </div>
      </div>

      {/* Pending-review action row */}
      {isPending && !justAccepted && (
        <div className="px-2.5 pb-2.5 flex gap-2">
          <button
            onClick={accept}
            disabled={!!busy}
            className="flex-1 text-xs font-semibold py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
          >
            {busy === 'accepting' ? 'Accepting…' : '✓ Accept tag'}
          </button>
          <button
            onClick={remove}
            disabled={!!busy}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-white border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >Reject</button>
        </div>
      )}

      {justAccepted && (
        <div className="px-2.5 pb-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <span className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px]">✓</span>
            Tag accepted — saved to this video
          </div>
        </div>
      )}

      {actionError && (
        <div className="px-2.5 pb-2.5">
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-2.5 py-1.5">
            <span className="font-semibold">Couldn't save:</span>
            <span className="flex-1">{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 font-bold">×</button>
          </div>
        </div>
      )}

      {showRules && tag.product_handle && merchantId && (
        <ProductRuleEditor
          merchantId={merchantId}
          productHandle={tag.product_handle}
          productName={tag.product_name}
        />
      )}
    </div>
  );
}
