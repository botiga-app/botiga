'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSignup(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { data, error: signupError } = await supabase.auth.signUp({ email, password });
    if (signupError) { setError(signupError.message); setLoading(false); return; }

    // Create merchant record in API
    const res = await fetch(`${API}/api/merchants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, website_url: website, auth_uid: data.user?.id })
    });

    if (!res.ok) {
      const d = await res.json();
      setError(d.error || 'Failed to create account');
      setLoading(false);
      return;
    }

    router.push('/dashboard');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">botiga.ai</h1>
          <p className="text-gray-500 mt-2">Start your 30-day free trial</p>
        </div>
        <form onSubmit={handleSignup} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
            <input type="text" required value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              placeholder="Jane Smith" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Store URL</label>
            <input type="url" value={website} onChange={e => setWebsite(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              placeholder="https://yourstore.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              placeholder="you@store.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              placeholder="8+ characters" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-60">
            {loading ? 'Creating account...' : 'Start free trial'}
          </button>
          <p className="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link href="/login" className="text-indigo-600 font-medium hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
