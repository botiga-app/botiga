'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function Avatar({ name, merchant }) {
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${
      merchant ? 'bg-gradient-to-br from-pink-500 to-rose-500' : 'bg-gradient-to-br from-indigo-500 to-violet-500'
    }`}>
      {(name || 'A')[0].toUpperCase()}
    </div>
  );
}

export default function CommentsPage() {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState(null);
  const [replyText, setReplyText] = useState({});
  const [replying, setReplying] = useState(null);
  const [sending, setSending] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      const res = await fetch(`${API}/api/merchants/${user.id}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function sendReply(commentId, videoId) {
    const text = (replyText[commentId] || '').trim();
    if (!text) return;
    setSending(true);
    const res = await fetch(`${API}/api/merchants/${merchantId}/videos/${videoId}/comments/${commentId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text }),
    });
    if (res.ok) {
      setReplyText(prev => ({ ...prev, [commentId]: '' }));
      setReplying(null);
      // Refresh
      const r2 = await fetch(`${API}/api/merchants/${merchantId}/comments`);
      if (r2.ok) { const d = await r2.json(); setComments(d.comments || []); }
    }
    setSending(false);
  }

  const unreplied = comments.filter(c => !c.has_reply).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Video Comments</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {comments.length} total
            {unreplied > 0 && <span className="ml-2 text-pink-600 font-semibold">{unreplied} need a reply</span>}
          </p>
        </div>
      </div>

      {loading && (
        <div className="text-center py-16 text-gray-400">Loading comments…</div>
      )}

      {!loading && comments.length === 0 && (
        <div className="text-center py-16 bg-gray-50 rounded-2xl">
          <div className="text-4xl mb-3">💬</div>
          <p className="text-gray-500 font-medium">No comments yet</p>
          <p className="text-sm text-gray-400 mt-1">Comments left on your shoppable videos will appear here.</p>
        </div>
      )}

      <div className="space-y-4">
        {comments.map(comment => (
          <div key={comment.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Video label */}
            {comment.video && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                {comment.video.thumbnail_url && (
                  <img src={comment.video.thumbnail_url} alt="" className="w-7 h-7 rounded-md object-cover" />
                )}
                <span className="text-xs font-semibold text-gray-500 truncate">{comment.video.title || 'Video'}</span>
                <span className="ml-auto text-xs text-gray-400">{timeAgo(comment.created_at)}</span>
              </div>
            )}

            <div className="p-4">
              {/* Customer comment */}
              <div className="flex gap-3">
                <Avatar name={comment.author_name} merchant={false} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-900">{comment.author_name}</span>
                    {comment.author_email && (
                      <span className="text-xs text-gray-400">{comment.author_email}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{comment.body}</p>
                </div>
              </div>

              {/* Existing replies */}
              {comment.replies && comment.replies.length > 0 && (
                <div className="mt-3 ml-11 space-y-3">
                  {comment.replies.map(reply => (
                    <div key={reply.id} className="flex gap-3">
                      <Avatar name={reply.author_name} merchant={reply.is_merchant_reply} />
                      <div className="flex-1 bg-pink-50 rounded-xl px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-gray-900">{reply.author_name}</span>
                          {reply.is_merchant_reply && (
                            <span className="text-xs bg-pink-500 text-white px-1.5 py-0.5 rounded font-bold">Shop</span>
                          )}
                          <span className="text-xs text-gray-400 ml-auto">{timeAgo(reply.created_at)}</span>
                        </div>
                        <p className="text-xs text-gray-700 leading-relaxed">{reply.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply input */}
              <div className="mt-3 ml-11">
                {replying === comment.id ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={replyText[comment.id] || ''}
                      onChange={e => setReplyText(prev => ({ ...prev, [comment.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && sendReply(comment.id, comment.video_id)}
                      placeholder="Write a reply as the shop…"
                      className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-300"
                    />
                    <button
                      onClick={() => sendReply(comment.id, comment.video_id)}
                      disabled={sending || !replyText[comment.id]?.trim()}
                      className="bg-pink-500 text-white text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-40"
                    >
                      {sending ? '…' : 'Reply'}
                    </button>
                    <button
                      onClick={() => setReplying(null)}
                      className="text-gray-400 text-xs px-2"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setReplying(comment.id)}
                    className="text-xs font-semibold text-pink-500 hover:text-pink-600"
                  >
                    ↩ Reply as shop
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
