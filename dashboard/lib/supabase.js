import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export function createClient() {
  return createClientComponentClient({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  });
}

// For Server Components only — do not call from Client Components
export async function createServerClient() {
  const { cookies } = await import('next/headers');
  const { createServerComponentClient } = await import('@supabase/auth-helpers-nextjs');
  return createServerComponentClient({ cookies });
}
