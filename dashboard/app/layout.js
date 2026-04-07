import './globals.css';

export const metadata = {
  title: 'Botiga — AI Negotiation for Your Store',
  description: 'Let customers negotiate prices with your AI bot. Close more deals, keep margins safe.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
