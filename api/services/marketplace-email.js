/**
 * Marketplace email — notifies merchant when a deal is won via the marketplace.
 */

const { sendDealEmail } = require('./email');

let resend = null;
let brevo = null;
let nodemailerTransport = null;

if (process.env.AWS_SES_SMTP_USER && process.env.AWS_SES_SMTP_PASS) {
  const nodemailer = require('nodemailer');
  nodemailerTransport = nodemailer.createTransport({
    host: process.env.AWS_SES_SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com',
    port: 465, secure: true,
    auth: { user: process.env.AWS_SES_SMTP_USER, pass: process.env.AWS_SES_SMTP_PASS }
  });
} else if (process.env.BREVO_API_KEY) {
  const SibApiV3Sdk = require('@getbrevo/brevo');
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
  apiInstance.authentications['apiKey'].apiKey = process.env.BREVO_API_KEY;
  brevo = apiInstance;
} else if (process.env.RESEND_API_KEY) {
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
} else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  const nodemailer = require('nodemailer');
  nodemailerTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

const FROM_NAME = 'Botiga Marketplace';
const FROM = process.env.RESEND_FROM_EMAIL || process.env.BREVO_FROM_EMAIL || process.env.GMAIL_USER || 'deals@botiga.ai';

async function sendRaw({ to, subject, html }) {
  if (!to) return;
  try {
    if (brevo) {
      const SibApiV3Sdk = require('@getbrevo/brevo');
      const mail = new SibApiV3Sdk.SendSmtpEmail();
      mail.subject = subject; mail.htmlContent = html;
      mail.sender = { name: FROM_NAME, email: FROM };
      mail.to = [{ email: to }];
      await brevo.sendTransacEmail(mail);
    } else if (resend) {
      await resend.emails.send({ from: `${FROM_NAME} <${FROM}>`, to, subject, html });
    } else if (nodemailerTransport) {
      await nodemailerTransport.sendMail({ from: `${FROM_NAME} <${FROM}>`, to, subject, html });
    } else {
      console.warn('[MarketplaceEmail] No email provider configured.');
    }
  } catch (err) {
    console.error('[MarketplaceEmail] Failed:', err.message);
  }
}

async function sendMerchantDealAlert({
  merchantEmail,
  merchantName,
  productTitle,
  listPrice,
  dealPrice,
  commissionPct,
  commissionAmount,
  customerName,
  customerEmail,
  customerPhone,
  discountCode,
  storeDomain,
  productHandle,
}) {
  const saved = Math.round(listPrice - dealPrice);
  const savedPct = Math.round((saved / listPrice) * 100);
  const net = (dealPrice - commissionAmount).toFixed(2);
  const productUrl = `https://${storeDomain}/products/${productHandle}`;

  const subject = `🛍️ New deal: ${productTitle} sold at $${dealPrice} via Botiga Marketplace`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">
    <div style="background:#111;padding:28px 36px;">
      <div style="color:#fff;font-size:20px;font-weight:700;">🎉 You got a deal!</div>
      <div style="color:#aaa;font-size:13px;margin-top:4px;">via Botiga Marketplace</div>
    </div>
    <div style="padding:32px 36px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#888;width:140px;">Product</td><td style="font-weight:600;color:#111;"><a href="${productUrl}" style="color:#111;">${productTitle}</a></td></tr>
        <tr><td style="padding:8px 0;color:#888;">List price</td><td style="color:#111;">$${listPrice}</td></tr>
        <tr><td style="padding:8px 0;color:#888;">Deal price</td><td style="font-weight:700;color:#16a34a;">$${dealPrice} (${savedPct}% off)</td></tr>
        <tr><td style="padding:8px 0;color:#888;">Commission (${commissionPct}%)</td><td style="color:#e55;">−$${commissionAmount.toFixed(2)}</td></tr>
        <tr><td style="padding:8px 0;color:#888;font-weight:600;">Your net</td><td style="font-weight:700;color:#111;">$${net}</td></tr>
        ${discountCode ? `<tr><td style="padding:8px 0;color:#888;">Discount code</td><td style="font-family:monospace;font-weight:600;">${discountCode}</td></tr>` : ''}
      </table>

      <hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0;" />

      <div style="font-size:14px;font-weight:600;color:#111;margin-bottom:12px;">Customer details</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#888;width:140px;">Name</td><td>${customerName || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Email</td><td>${customerEmail || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Phone/WhatsApp</td><td>${customerPhone || '—'}</td></tr>
      </table>

      <div style="margin-top:28px;background:#fffbeb;border-radius:8px;padding:14px 16px;font-size:13px;color:#92400e;">
        Please process this order manually on your Shopify store using the discount code above, or reach out to the customer directly. Botiga has collected ${commissionPct}% as a service fee.
      </div>
    </div>
    <div style="border-top:1px solid #f0f0f0;padding:18px 36px;text-align:center;font-size:11px;color:#ccc;">
      Powered by <a href="https://botiga.ai" style="color:#ccc;">botiga.ai</a>
    </div>
  </div>
</body>
</html>`.trim();

  await sendRaw({ to: merchantEmail, subject, html });
}

async function sendCustomerDealConfirmation({
  customerEmail,
  customerName,
  productTitle,
  dealPrice,
  listPrice,
  discountCode,
  storeDomain,
  productHandle,
  productImage,
}) {
  const checkoutUrl = `https://${storeDomain}/cart?discount=${encodeURIComponent(discountCode || '')}`;
  await sendDealEmail({
    to: customerEmail,
    productName: productTitle,
    dealPrice,
    listPrice,
    discountCode,
    checkoutUrl,
    productImage,
  });
}

module.exports = { sendMerchantDealAlert, sendCustomerDealConfirmation };
