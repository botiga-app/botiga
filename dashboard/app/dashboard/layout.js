import { redirect } from 'next/navigation';
import { createServerClient } from '../../lib/supabase';
import DashboardLayout from '../../components/DashboardLayout';

export default async function Layout({ children }) {
  const supabase = createServerClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <DashboardLayout>
      {children}
    </DashboardLayout>
  );
}
