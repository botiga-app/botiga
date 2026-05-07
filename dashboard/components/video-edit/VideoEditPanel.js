'use client';
import { useState } from 'react';
import AiTagger from './AiTagger';
import ProductPicker from './ProductPicker';
import TagRow from './TagRow';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';

// THE single video-editing panel. Extracted whole from VideoDetailDrawer
// so /dashboard/videos (grid drawer) and /dashboard/videos/preview
// (vertical scroll) render identical UI. Contents:
//   - editable caption header
//   - tagged products section (TagRow list with Accept/Reject)
//   - add product section (ProductPicker + AI Create → modal)
//   - video settings (hide/show, preview link, delete)
//
// Props mirror VideoDetailDrawer's:
//   video           — the video row
//   merchantId      — UUID
//   shopifyDomain   — *.myshopify.com host
//   onTagsUpdated   — (videoId, nextTagsOrFn) => void
//   onDelete        — (videoId) => Promise<void>  (caller confirms before)
//   onToggleStatus  — (videoId, nextStatus: 'active' | 'inactive') => Promise<void>
//   showCloseButton — true in drawer (renders ×), false in preview (already in panel)
//   onClose         — () => void  (drawer dismiss; ignored if showCloseButton=false)
function Section({ title, count, children }) {
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2.5 flex items-center gap-2">
        {title}
        {typeof count === 'number' && <span className="text-gray-400 font-normal">{count}</span>}
      </h3>
      {children}
    </div>
  );
}

export default function VideoEditPanel({
  video,
  merchantId,
  shopifyDomain,
  onTagsUpdated,
  onDelete,
  onToggleStatus,
  showCloseButton = false,
  onClose,
}) {
  const [aiTaggerOpen, setAiTaggerOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(video.title || '');
  const [titleSaving, setTitleSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Both consumers key this component by video.id (drawer re-mounts when
  // opened on a new video, preview re-mounts via key={activeVideo.id})
  // so titleDraft naturally resets — no syncing effect needed.

  async function saveTitle() {
    if (titleDraft === video.title) return;
    setTitleSaving(true);
    await fetch(`${API}/api/videos/${video.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleDraft }),
    });
    setTitleSaving(false);
  }

  const tags = video.video_product_tags || [];
  const isActive = video.status === 'active';

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden h-full">
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <textarea
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              placeholder="Untitled — click to add a caption"
              rows={1}
              className="w-full text-base font-semibold text-gray-900 bg-transparent border-0 focus:outline-none focus:bg-indigo-50/40 rounded px-1 -mx-1 resize-none leading-snug"
              style={{ minHeight: '1.5em', height: 'auto' }}
              onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
            />
            <p className="text-xs text-gray-500 mt-0.5">
              {titleSaving ? 'Saving…' : isActive ? 'Live on storefront · click caption to edit' : 'Hidden from storefront · click caption to edit'}
            </p>
          </div>
          {showCloseButton && (
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 text-xl flex-shrink-0"
              aria-label="Close"
            >×</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <Section title="Tagged products" count={tags.length}>
            {tags.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-2">No products tagged. Add one below.</p>
            ) : (
              <div className="space-y-2">
                {tags.map(tag => (
                  <TagRow
                    key={tag.id}
                    tag={tag}
                    videoId={video.id}
                    merchantId={merchantId}
                    shopifyDomain={shopifyDomain}
                    onRemoved={() => onTagsUpdated(video.id, tags.filter(t => t.id !== tag.id))}
                    onUpdated={updated => onTagsUpdated(video.id, tags.map(t => t.id === updated.id ? updated : t))}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="Add product">
            <ProductPicker
              video={video}
              merchantId={merchantId}
              shopifyDomain={shopifyDomain}
              existingTagIds={new Set(tags.map(t => t.shopify_product_id))}
              onTagAdded={newTag => onTagsUpdated(video.id, [...tags, newTag])}
            />
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500">Or generate a new product from this video</span>
              <button
                onClick={() => setAiTaggerOpen(true)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >✨ AI Create →</button>
            </div>
          </Section>

          <Section title="Video settings">
            <div className="space-y-3">
              <button
                onClick={() => onToggleStatus(video.id, isActive ? 'inactive' : 'active')}
                className="w-full flex items-center justify-between text-sm py-2.5 px-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <span className="text-gray-900 font-medium">
                  {isActive ? 'Hide from storefront' : 'Show on storefront'}
                </span>
                <span className="text-xs text-gray-500">{isActive ? 'Currently live' : 'Currently hidden'}</span>
              </button>
              {shopifyDomain && (
                <a
                  href={`https://${shopifyDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}/?btgv=${encodeURIComponent(video.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full flex items-center justify-between text-sm py-2.5 px-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-gray-900 font-medium">Preview this video</span>
                  <span className="text-xs text-gray-500">Customer view ↗</span>
                </a>
              )}

              {confirmDelete ? (
                <div className="flex gap-2">
                  <button
                    onClick={async () => { await onDelete(video.id); if (showCloseButton && onClose) onClose(); }}
                    className="flex-1 text-sm font-semibold bg-red-600 text-white rounded-lg py-2.5 hover:bg-red-700"
                  >Yes, delete</button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 text-sm font-medium border border-gray-200 rounded-lg py-2.5 hover:bg-gray-50"
                  >Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg py-2.5 transition-colors"
                >Delete video</button>
              )}
            </div>
          </Section>
        </div>
      </div>

      {aiTaggerOpen && (
        <AiTagger
          video={video}
          merchantId={merchantId}
          onTagsUpdated={onTagsUpdated}
          onClose={() => setAiTaggerOpen(false)}
        />
      )}
    </>
  );
}
