import { redirect } from 'next/navigation';
import { createServerClient } from '../../lib/supabase';
import AdminLayoutClient from './AdminLayoutClient';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Check admin metadata
  const isAdmin = user.user_metadata?.admin === true;
  if (!isAdmin) redirect('/dashboard');

  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
