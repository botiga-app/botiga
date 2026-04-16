// Email provider priority: AWS SES → Brevo → Resend → Gmail SMTP
let brevo = null;
let resend = null;
let nodemailerTransport = null;

if (process.env.AWS_SES_SMTP_USER && process.env.AWS_SES_SMTP_PASS) {
  const nodemailer = require('nodemailer');
  nodemailerTransport = nodemailer.createTransport({
    host: process.env.AWS_SES_SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com',
    port: 465,
    secure: true,
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

const FROM_NAME = 'Botiga Deals';
const FROM = process.env.RESEND_FROM_EMAIL || process.env.BREVO_FROM_EMAIL || (resend ? 'onboarding@resend.dev' : process.env.GMAIL_USER) || 'deals@botiga.live';

function buildSubject({ productName, dealPrice, listPrice }) {
  const saved = Math.round(listPrice - dealPrice);
  const savedPct = Math.round((saved / listPrice) * 100);
  // Achievement-tag style — customer feels they earned this
  return `🥊 Negotiated · 🏆 You won · ${productName} for $${dealPrice} (${savedPct}% off)`;
}

async function sendDealEmail({ to, productName, dealPrice, listPrice, discountCode, checkoutUrl, expiresAt, productImage }) {
  if (!to) return;

  if (!brevo && !resend && !nodemailerTransport) {
    console.warn('[Email] No email provider configured.');
    return;
  }

  const saved = Math.round(listPrice - dealPrice);
  const savedPct = Math.round((saved / listPrice) * 100);
  const expiry = new Date(expiresAt);
  const expiryStr = expiry.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const minutesLeft = Math.round((expiry - Date.now()) / 60000);

  const subject = buildSubject({ productName, dealPrice, listPrice });

  const productImageBlock = productImage ? `
    <div style="text-align:center;padding:0 36px 24px;">
      <img src="${productImage}" alt="${productName}" style="max-width:100%;max-height:280px;object-fit:contain;border-radius:10px;" />
    </div>` : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:500px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.10);">

    <!-- Header -->
    <div style="background:#111;padding:28px 36px 24px;text-align:center;">
      <div style="display:inline-flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:14px;">
        <span style="background:#222;color:#facc15;font-size:11px;font-weight:700;letter-spacing:0.6px;padding:5px 12px;border-radius:20px;text-transform:uppercase;">🥊 Negotiated</span>
        <span style="background:#222;color:#4ade80;font-size:11px;font-weight:700;letter-spacing:0.6px;padding:5px 12px;border-radius:20px;text-transform:uppercase;">🏆 Deal won</span>
        <span style="background:#222;color:#f87171;font-size:11px;font-weight:700;letter-spacing:0.6px;padding:5px 12px;border-radius:20px;text-transform:uppercase;">⏱ ${minutesLeft} min left</span>
      </div>
      <div style="color:#fff;font-size:21px;font-weight:800;letter-spacing:-0.5px;line-height:1.3;">You haggled.<br>We caved.</div>
      <div style="color:#888;font-size:13px;margin-top:6px;">Your price is held until ${expiryStr}. Don't let it vanish.</div>
    </div>

    ${productImageBlock}

    <!-- Price block -->
    <div style="padding:${productImage ? '0' : '28px'} 36px 0;">
      <div style="font-size:12px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${productName}</div>
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:8px;">
        <span style="font-size:44px;font-weight:900;color:#111;letter-spacing:-1px;">$${dealPrice}</span>
        <span style="font-size:18px;color:#ccc;text-decoration:line-through;font-weight:400;">$${Math.round(listPrice)}</span>
      </div>
      <div style="display:inline-block;background:#f0fdf4;color:#15803d;font-size:13px;font-weight:700;padding:5px 14px;border-radius:20px;margin-bottom:24px;">
        💸 You saved $${saved} &nbsp;·&nbsp; ${savedPct}% off
      </div>
    </div>

    <!-- Journey -->
    <div style="margin:0 36px 24px;background:#fafafa;border-radius:12px;padding:14px 18px;">
      <div style="font-size:11px;color:#aaa;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Your negotiation</div>
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#555;">
        <span style="background:#fff;border:1px solid #e5e5e5;padding:4px 10px;border-radius:8px;font-weight:500;">Listed $${Math.round(listPrice)}</span>
        <span style="color:#ccc;font-size:16px;">→</span>
        <span style="background:#111;color:#fff;padding:4px 10px;border-radius:8px;font-weight:700;">Won $${dealPrice} 🎉</span>
      </div>
    </div>

    ${discountCode ? `
    <div style="margin:0 36px 24px;background:#fffbeb;border:1px dashed #fbbf24;border-radius:10px;padding:12px 16px;">
      <div style="font-size:11px;color:#92400e;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Discount code — auto-applied at checkout</div>
      <div style="font-family:monospace;font-size:16px;font-weight:800;color:#78350f;letter-spacing:1px;">${discountCode}</div>
    </div>` : ''}

    <!-- CTA -->
    <div style="padding:0 36px 32px;">
      <a href="${checkoutUrl}" style="display:block;background:#111;color:#fff;text-align:center;padding:18px;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:-0.3px;">
        Claim my deal — $${dealPrice} →
      </a>
      <div style="text-align:center;margin-top:12px;font-size:12px;color:#bbb;">
        This offer expires at ${expiryStr}. After that, it's gone forever.
      </div>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid #f0f0f0;padding:16px 36px;text-align:center;">
      <div style="font-size:11px;color:#ccc;">Powered by <a href="https://botiga.ai" style="color:#ccc;text-decoration:none;">botiga.ai</a></div>
    </div>

  </div>
</body>
</html>`.trim();

  // Plain-text version (helps avoid promotions tab)
  const text = `You haggled. We caved.

${productName}
Your price: $${dealPrice} (was $${Math.round(listPrice)})
You saved: $${saved} — ${savedPct}% off

${discountCode ? `Discount code: ${discountCode} (auto-applied at checkout)\n\n` : ''}Complete your order: ${checkoutUrl}

This deal expires at ${expiryStr}. After that, it's gone.

– Botiga`;

  try {
    if (brevo) {
      const SibApiV3Sdk = require('@getbrevo/brevo');
      const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
      sendSmtpEmail.subject = subject;
      sendSmtpEmail.htmlContent = html;
      sendSmtpEmail.textContent = text;
      sendSmtpEmail.sender = { name: FROM_NAME, email: FROM };
      sendSmtpEmail.to = [{ email: to }];
      await brevo.sendTransacEmail(sendSmtpEmail);
    } else if (resend) {
      await resend.emails.send({ from: `${FROM_NAME} <${FROM}>`, to, subject, html, text });
    } else if (nodemailerTransport) {
      await nodemailerTransport.sendMail({
        from: `${FROM_NAME} <${FROM}>`,
        to,
        subject,
        html,
        text,
        replyTo: process.env.REPLY_TO_EMAIL || FROM
      });
    }
    console.log('[Email] Deal email sent to', to);
  } catch (err) {
    console.error('[Email] Failed to send deal email:', err.message);
  }
}

module.exports = { sendDealEmail };
