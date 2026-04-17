export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 font-sans text-gray-800">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: April 17, 2026</p>

      <section className="space-y-8 text-sm leading-relaxed">

        <div>
          <h2 className="text-lg font-semibold mb-2">1. Who we are</h2>
          <p>
            Botiga AI ("Botiga", "we", "us") operates the Botiga AI Negotiation app available on the
            Shopify App Store, and the associated dashboard at botiga.ai. This policy explains what
            data we collect, how we use it, and your rights.
          </p>
          <p className="mt-2">
            Contact: <a href="mailto:privacy@botiga.ai" className="text-indigo-600 underline">privacy@botiga.ai</a>
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">2. Data we collect</h2>

          <h3 className="font-medium mt-4 mb-1">From merchants (store owners)</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Email address and name (from Shopify store profile, used for account creation)</li>
            <li>Shopify store domain and access token (to create discount codes at checkout)</li>
            <li>Negotiation settings and product rules you configure in the dashboard</li>
            <li>Billing plan and Shopify charge ID (managed by Shopify — we never see card details)</li>
          </ul>

          <h3 className="font-medium mt-4 mb-1">From shoppers (your customers)</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Email address or phone number (only if voluntarily provided during negotiation)</li>
            <li>The price offers and messages exchanged in the negotiation chat</li>
            <li>Product URL and list price of the item being negotiated</li>
            <li>Negotiation outcome (deal closed, abandoned, or declined)</li>
          </ul>

          <h3 className="font-medium mt-4 mb-1">Automatically collected</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>API usage logs for rate limiting and abuse prevention</li>
            <li>Error logs (do not contain personally identifiable information)</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">3. How we use data</h2>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>To operate the negotiation bot and generate AI responses</li>
            <li>To create Shopify discount codes when a deal is agreed</li>
            <li>To send abandoned deal recovery messages (only if merchant has enabled this and shopper provided contact info)</li>
            <li>To show merchants analytics about their negotiations in the dashboard</li>
            <li>To enforce plan limits and process billing</li>
            <li>To improve the AI negotiation model (aggregated, anonymized data only)</li>
          </ul>
          <p className="mt-3">
            We do not sell shopper data to third parties. We do not use shopper data for advertising.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">4. AI and third-party services</h2>
          <p>
            Botiga uses AI language models to generate negotiation responses. Negotiation messages
            (the text of offers and counter-offers) are sent to our AI provider for processing.
            We use Groq (groq.com) as our AI inference provider. Conversation data is not used to
            train third-party models and is subject to Groq's data processing agreement.
          </p>
          <p className="mt-2">
            We use Supabase for database storage and Vercel for hosting. Both are SOC 2 compliant.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">5. Data retention</h2>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Negotiation records are retained for 12 months, then automatically deleted</li>
            <li>Merchant account data is retained while the app is installed</li>
            <li>When a merchant uninstalls the app, their Shopify access token is immediately deleted</li>
            <li>Full merchant data deletion is completed within 30 days of a shop redact request</li>
            <li>Shopper data is anonymized upon a customer redact request (GDPR Article 17)</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">6. Your rights (GDPR / CCPA)</h2>
          <p>If you are a shopper whose data was collected through a Botiga-powered store:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2 text-gray-700">
            <li><strong>Right to access:</strong> Request a copy of your data by emailing privacy@botiga.ai</li>
            <li><strong>Right to deletion:</strong> Request deletion of your negotiation data at any time</li>
            <li><strong>Right to portability:</strong> Receive your data in a machine-readable format</li>
            <li><strong>Right to object:</strong> Opt out of recovery messages at any time</li>
          </ul>
          <p className="mt-3">
            If you are a merchant, you can delete your account and all associated data from the
            dashboard, or by emailing privacy@botiga.ai. We will complete deletion within 30 days.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">7. Cookies</h2>
          <p>
            The Botiga widget uses a single session cookie to maintain negotiation state across
            page views (so a shopper's offer isn't lost if they navigate away). No tracking
            cookies or advertising pixels are used.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">8. Security</h2>
          <p>
            All data is encrypted in transit (TLS 1.3) and at rest. Shopify access tokens are
            stored encrypted in our database. We do not log or store raw access tokens in
            application logs.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">9. Changes to this policy</h2>
          <p>
            We will notify merchants of material changes to this policy via email and in-app
            notification at least 14 days before changes take effect.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">10. Contact</h2>
          <p>
            For privacy questions, data requests, or to report a concern:<br />
            <a href="mailto:privacy@botiga.ai" className="text-indigo-600 underline">privacy@botiga.ai</a>
          </p>
        </div>

      </section>
    </div>
  );
}
