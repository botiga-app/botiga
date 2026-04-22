'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Nav from '../../components/Nav';
import ProductCard from '../../components/ProductCard';
import { searchProducts } from '../../lib/api';

function SearchResults() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get('q') || '';
  const [inputVal, setInputVal] = useState(query);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [intent, setIntent] = useState(null);
  const lastQuery = useRef('');

  useEffect(() => {
    if (!query || query === lastQuery.current) return;
    lastQuery.current = query;
    setInputVal(query);
    setLoading(true);
    setError(null);
    searchProducts(query)
      .then(data => {
        setResults(data.products || []);
        setIntent(data.intent);
      })
      .catch(err => setError(err.message || 'Search failed'))
      .finally(() => setLoading(false));
  }, [query]);

  function handleSearch(e) {
    e.preventDefault();
    const q = inputVal.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        {/* Search bar */}
        <form onSubmit={handleSearch} className="relative w-full max-w-xl mb-8">
          <input
            type="text"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            className="w-full pl-5 pr-28 py-3.5 rounded-xl border border-gray-200 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
          />
          <button type="submit" className="absolute right-2 top-2 bottom-2 px-5 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition-colors text-sm">
            Search →
          </button>
        </form>

        {/* Intent chip */}
        {intent && !loading && (
          <div className="flex flex-wrap gap-2 mb-6 text-xs text-gray-500">
            {intent.category && <span className="bg-purple-50 text-purple-700 px-2 py-1 rounded-full">{intent.category}</span>}
            {intent.maxPrice && <span className="bg-green-50 text-green-700 px-2 py-1 rounded-full">Under ${intent.maxPrice}</span>}
            {intent.minPrice && <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-full">Over ${intent.minPrice}</span>}
            {intent.occasion && <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-full">{intent.occasion}</span>}
          </div>
        )}

        {/* States */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
            <div className="text-sm text-gray-400">Searching across stores...</div>
          </div>
        )}

        {error && (
          <div className="text-center py-20 text-red-500">{error}</div>
        )}

        {!loading && results && results.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🔍</div>
            <div className="font-semibold text-gray-700 mb-2">No products found</div>
            <div className="text-sm text-gray-400">Try different keywords or a broader search</div>
          </div>
        )}

        {!loading && results && results.length > 0 && (
          <>
            <div className="text-sm text-gray-400 mb-5">{results.length} products found for "{query}"</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {results.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}
