import './globals.css';

export const metadata = {
  title: 'Botiga — Shop & Negotiate',
  description: 'Search products from top stores, negotiate the best price with AI, and buy.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}
