export function detectMerchantStyles() {
  const selectors = [
    '[data-add-to-cart]',
    '.btn-cart',
    '#add-to-cart',
    '[name="add"]',
    '.product-form__cart-submit',
    'button[type="submit"].btn',
    '.add-to-cart-btn',
    '.btn-addtocart',
    '#AddToCart'
  ];

  let addToCartBtn = null;
  for (const sel of selectors) {
    addToCartBtn = document.querySelector(sel);
    if (addToCartBtn) break;
  }

  if (!addToCartBtn) {
    const buttons = [...document.querySelectorAll('button')];
    addToCartBtn = buttons.find(b =>
      b.textContent.toLowerCase().includes('cart') ||
      b.textContent.toLowerCase().includes('buy') ||
      b.textContent.toLowerCase().includes('add')
    );
  }

  if (!addToCartBtn) {
    return {
      backgroundColor: '#1a1a2e',
      color: '#ffffff',
      fontFamily: 'system-ui, sans-serif',
      borderRadius: '6px',
      fontSize: '14px',
      padding: '12px 20px',
      width: '100%'
    };
  }

  const styles = window.getComputedStyle(addToCartBtn);
  return {
    backgroundColor: styles.backgroundColor,
    color: styles.color,
    fontFamily: styles.fontFamily,
    borderRadius: styles.borderRadius,
    fontSize: styles.fontSize,
    padding: styles.padding,
    width: styles.width
  };
}

export function detectProductInfo() {
  // Try to get product name and price from common meta tags / schema.org
  let name = null;
  let price = null;
  let url = window.location.href;

  // og:title
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) name = ogTitle.getAttribute('content');

  // Schema.org Product
  const schemas = document.querySelectorAll('script[type="application/ld+json"]');
  for (const s of schemas) {
    try {
      const data = JSON.parse(s.textContent);
      const product = data['@type'] === 'Product' ? data : (data['@graph'] || []).find(n => n['@type'] === 'Product');
      if (product) {
        if (!name) name = product.name;
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        if (offer && offer.price) price = parseFloat(offer.price);
      }
    } catch {}
  }

  // Fallback: look for price in common selectors
  if (!price) {
    const priceEls = document.querySelectorAll('.price, .product-price, [data-price], .price__current, .woocommerce-Price-amount');
    for (const el of priceEls) {
      const text = el.textContent.replace(/[^0-9.]/g, '');
      const parsed = parseFloat(text);
      if (parsed > 0) { price = parsed; break; }
    }
  }

  if (!name) name = document.title;

  return { name, price, url };
}
