import Script from 'next/script';
import { notFound } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';

async function getShop(handle) {
  try {
    const res = await fetch(`${API_BASE}/api/shop/${encodeURIComponent(handle)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  const shop = await getShop(params.handle);
  if (!shop) return { title: 'Shop not found · Botiga' };
  return {
    title: `${shop.name} · Shop the videos`,
    description: `Browse and negotiate ${shop.name}'s shoppable videos on Botiga.`,
  };
}

export default async function ShopPage({ params }) {
  const shop = await getShop(params.handle);
  if (!shop) notFound();

  return (
    <>
      {/* Botiga widgets — same script tag the storefront uses */}
      <Script
        src={`${API_BASE}/video.js`}
        data-key={shop.api_key}
        strategy="afterInteractive"
      />

      <div className="shop-frame">
        <header className="shop-header">
          <h1>{shop.name}</h1>
          <p>{shop.video_count} {shop.video_count === 1 ? 'video' : 'videos'} · {shop.product_count} products</p>
        </header>

        {/* Stories bar will be injected here by video.js */}
        <div id="btgv-stories"></div>

        <main>
          {shop.video_count === 0 ? (
            <div className="empty">
              <p>This shop hasn't added any videos yet.</p>
            </div>
          ) : (
            <div className="hero">
              <p className="prompt">Tap any video below to shop — and negotiate any price. ✨</p>
            </div>
          )}
        </main>
      </div>

      <style>{`
        body { background: #fff; margin: 0; }
        .shop-frame { max-width: 720px; margin: 0 auto; min-height: 100vh; }
        .shop-header { padding: 28px 20px 12px; text-align: center; }
        .shop-header h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
        .shop-header p { font-size: 13px; color: #666; margin: 0; }
        main { padding: 0 20px 100px; }
        .hero { padding: 16px 0 0; }
        .prompt { color: #666; font-size: 14px; text-align: center; margin: 0; }
        .empty { padding: 80px 20px; text-align: center; color: #888; font-size: 14px; }
      `}</style>
    </>
  );
}
