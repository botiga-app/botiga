export default function SupportPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 font-sans text-gray-800">
      <h1 className="text-3xl font-bold mb-2">Support</h1>
      <p className="text-gray-500 mb-10 text-sm">We typically respond within 24 hours.</p>

      <div className="space-y-10">

        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6">
          <h2 className="font-semibold text-indigo-900 mb-1">Contact us</h2>
          <p className="text-sm text-indigo-700">
            Email: <a href="mailto:support@botiga.ai" className="underline font-medium">support@botiga.ai</a>
          </p>
          <p className="text-xs text-indigo-500 mt-1">Response time: within 24 hours on business days.</p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4">Frequently asked questions</h2>
          <div className="space-y-6">

            {[
              {
                q: "How do I install the widget on my store?",
                a: "Go to your Botiga dashboard → Install tab. You can either add the Botiga block via the Shopify Theme Editor (no code required, recommended) or paste one line of code into your theme.liquid file."
              },
              {
                q: "The widget isn't appearing on my product pages. What do I check?",
                a: "First, make sure 'Show on product pages' is enabled in Settings. Second, confirm your API key in the Install tab matches what's in your theme. Third, check the dwell time setting — by default the button appears after 30 seconds on the page."
              },
              {
                q: "How does the bot decide what price to accept?",
                a: "The bot negotiates within the floor price you set. If you set a 20% max discount on a $100 item, the bot will never accept less than $80. You set the limits — the AI handles the conversation."
              },
              {
                q: "Can I set different rules for different products?",
                a: "Yes. Go to Product Rules in your dashboard to set per-product, per-tag, or per-collection discount limits. Products with no rule inherit your global settings."
              },
              {
                q: "How do discount codes get applied at checkout?",
                a: "When a deal is agreed, Botiga creates a unique one-time discount code in Shopify and gives it to the customer. The customer applies it at checkout. You need to connect your Shopify store in the Install tab for this to work."
              },
              {
                q: "What is cart negotiation?",
                a: "Cart negotiation lets customers negotiate the price of their entire cart as a bundle. Enable it in Settings. It's useful for increasing order value — customers feel they're getting a bundle deal."
              },
              {
                q: "How does abandoned deal recovery work?",
                a: "If a customer gets an offer but doesn't checkout, Botiga waits a set time and then sends a follow-up message with the deal still available. Enable it in Settings and choose email or WhatsApp as the channel."
              },
              {
                q: "I'm on the free plan and negotiations stopped working. Why?",
                a: "The free plan includes 50 negotiations per month. Once you reach the limit, the widget pauses until the next month or you upgrade. Go to Billing in your dashboard to upgrade."
              },
              {
                q: "How do I cancel my subscription?",
                a: "You can downgrade to the free plan from the Billing tab in your dashboard at any time. Alternatively, uninstalling the app from Shopify will cancel all charges automatically."
              },
              {
                q: "Is the widget GDPR compliant?",
                a: "Yes. Botiga only collects shopper data (email/phone) if the customer voluntarily provides it. We comply with GDPR data requests and deletion requests. See our Privacy Policy for full details."
              }
            ].map(({ q, a }) => (
              <div key={q} className="border-b border-gray-100 pb-5">
                <h3 className="font-medium text-gray-900 mb-1">{q}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-6 text-sm text-gray-600">
          <p className="font-medium text-gray-800 mb-1">Still stuck?</p>
          <p>Email us at <a href="mailto:support@botiga.ai" className="text-indigo-600 underline">support@botiga.ai</a> with your store URL and a description of the issue. Screenshots help!</p>
        </div>

      </div>
    </div>
  );
}
