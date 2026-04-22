'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, startNegotiation, sendMessage } from '../lib/api';

export default function NegotiateModal({ product, onClose }) {
  const router = useRouter();
  const [phase, setPhase] = useState('start'); // start | chat | won | error
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [negId, setNegId] = useState(null);
  const [deal, setDeal] = useState(null);
  const bottomRef = useRef(null);

  const image = (product.images || [])[0] || null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleStart() {
    if (!getToken()) {
      // Save intent and redirect to signup
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('btg_after_auth', window.location.pathname);
        sessionStorage.setItem('btg_negotiate_product', product.id);
      }
      router.push('/auth/signup');
      return;
    }
    setLoading(true);
    try {
      const data = await startNegotiation(product.id);
      setNegId(data.negotiation_id);
      setMessages([{ role: 'assistant', content: data.message }]);
      setPhase('chat');
    } catch (err) {
      setMessages([{ role: 'assistant', content: 'Something went wrong starting the negotiation. Please try again.' }]);
      setPhase('chat');
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || loading || !negId) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const data = await sendMessage(negId, { message: msg });
      if (data.status === 'won') {
        setDeal(data);
        setPhase('won');
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-3xl w-full max-w-sm shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-100">
          {image && <img src={image} alt={product.title} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900 truncate">{product.title}</div>
            <div className="text-xs text-gray-400">{product.store_name || product.vendor}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1">×</button>
        </div>

        {/* Start phase */}
        {phase === 'start' && (
          <div className="flex flex-col items-center justify-center p-8 gap-5 text-center">
            <div className="text-4xl">🤝</div>
            <div>
              <div className="font-bold text-gray-900 text-lg mb-1">Negotiate this price</div>
              <div className="text-gray-500 text-sm">Our AI will haggle for you — list price is <strong>${product.price}</strong>, you could pay less.</div>
            </div>
            <div className="text-xs text-gray-400 bg-gray-50 rounded-xl px-4 py-3">
              Up to <strong>{product.max_discount_pct || 20}% off</strong> possible · Deal expires in 48h
            </div>
            <button
              onClick={handleStart}
              disabled={loading}
              className="w-full bg-purple-600 text-white font-semibold py-3.5 rounded-2xl hover:bg-purple-700 transition-colors disabled:opacity-60"
            >
              {loading ? 'Starting...' : 'Start negotiation →'}
            </button>
          </div>
        )}

        {/* Chat phase */}
        {phase === 'chat' && (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-snug ${
                    m.role === 'user'
                      ? 'bg-purple-600 text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 px-4 py-2.5 rounded-2xl rounded-bl-sm">
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={handleSend} className="p-3 border-t border-gray-100 flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Make an offer..."
                className="flex-1 bg-gray-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="bg-purple-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 text-sm"
              >
                Send
              </button>
            </form>
          </>
        )}

        {/* Won phase */}
        {phase === 'won' && deal && (
          <div className="flex flex-col items-center justify-center p-8 gap-5 text-center">
            <div className="text-5xl">🎉</div>
            <div>
              <div className="font-bold text-gray-900 text-xl mb-1">Deal locked in!</div>
              <div className="text-gray-500 text-sm mb-4">Your negotiated price is</div>
              <div className="text-4xl font-extrabold text-green-600">${deal.deal_price}</div>
              <div className="text-sm text-gray-400 mt-1">down from ${product.price}</div>
            </div>
            {deal.discount_code && (
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-500 w-full">
                Discount code <strong className="font-mono text-gray-800">{deal.discount_code}</strong> applied automatically
              </div>
            )}
            {deal.cart_url ? (
              <a
                href={deal.cart_url}
                className="w-full bg-green-600 text-white font-semibold py-3.5 rounded-2xl hover:bg-green-700 transition-colors text-center block"
              >
                Complete my order →
              </a>
            ) : (
              <div className="text-sm text-gray-500">Check your email for checkout instructions.</div>
            )}
            <div className="text-xs text-gray-400">Deal confirmed · Check your email for a copy</div>
          </div>
        )}
      </div>
    </div>
  );
}
