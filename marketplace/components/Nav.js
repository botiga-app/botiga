'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken, getMe } from '../lib/api';

export default function Nav() {
  const [customer, setCustomer] = useState(null);

  useEffect(() => {
    if (getToken()) {
      getMe().then(d => setCustomer(d.customer)).catch(() => {});
    }
  }, []);

  return (
    <nav className="w-full border-b border-gray-100 bg-white px-4 py-3 flex items-center justify-between sticky top-0 z-10">
      <Link href="/" className="font-extrabold text-lg tracking-tight text-gray-900">
        botiga<span className="text-purple-600">.ai</span>
      </Link>
      <div className="flex items-center gap-3">
        {customer ? (
          <Link href="/account" className="text-sm font-medium text-gray-700 hover:text-purple-600">
            {customer.name || customer.email}
          </Link>
        ) : (
          <>
            <Link href="/auth/login" className="text-sm font-medium text-gray-600 hover:text-gray-900">Sign in</Link>
            <Link href="/auth/signup" className="text-sm font-semibold bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors">
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
