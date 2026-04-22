'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Nav from '../components/Nav';

const EXAMPLES = [
  'floral maxi dress under $80',
  'vintage denim jacket',
  'silk blouse for wedding guest',
  'oversized linen blazer',
  'embroidered kurta set',
];

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  function handleSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-20">
        {/* Hero */}
        <div className="text-center max-w-2xl w-full mt-16 mb-12">
          <div className="inline-flex items-center gap-2 bg-purple-50 text-purple-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <span>✨</span> AI-powered negotiation marketplace
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight text-gray-900 mb-4 leading-tight">
            Tell us what you want.<br />
            <span className="text-purple-600">We'll find it and negotiate.</span>
          </h1>
          <p className="text-gray-500 text-lg mb-10">
            Search across top stores, let AI haggle for you, pay less.
          </p>

          <form onSubmit={handleSearch} className="relative w-full max-w-xl mx-auto">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. floral maxi dress under $80..."
              className="w-full pl-5 pr-32 py-4 rounded-2xl border border-gray-200 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
              autoFocus
            />
            <button
              type="submit"
              className="absolute right-2 top-2 bottom-2 px-6 bg-purple-600 text-white font-semibold rounded-xl hover:bg-purple-700 transition-colors text-sm"
            >
              Search →
            </button>
          </form>

          <div className="flex flex-wrap gap-2 justify-center mt-5">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                onClick={() => { setQuery(ex); router.push(`/search?q=${encodeURIComponent(ex)}`); }}
                className="text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 hover:border-purple-400 hover:text-purple-700 transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl w-full mt-8">
          {[
            { icon: '🔍', title: 'Describe what you want', body: 'Search in plain English. Our AI understands style, budget, and occasion.' },
            { icon: '🤖', title: 'AI negotiates for you', body: 'Our bot haggles in real-time until you get the best price the merchant can offer.' },
            { icon: '🎁', title: 'Buy with your deal price', body: 'Accept the deal and check out directly on the merchant\'s store with your locked price.' },
          ].map(card => (
            <div key={card.title} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="text-3xl mb-3">{card.icon}</div>
              <div className="font-semibold text-gray-900 mb-1">{card.title}</div>
              <div className="text-sm text-gray-500">{card.body}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
