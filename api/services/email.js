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

async function sendDealEmail({ to, productName, dealPrice, listPrice, discountCode, checkoutUrl, expiresAt, productImage }) {
  if (!to) return;

  if (!brevo && !resend && !nodemailerTransport) {
    console.warn('[Email] No email provider configured.');
    return;
  }

  const saved = Math.round(listPrice - dealPrice);
  const savedPct = Math.round((saved / listPrice) * 100);

  const subject = `Your deal on ${productName} — $${dealPrice} (${savedPct}% off)`;
  const imgBlock = productImage
    ? `<div style="text-align:center;padding:24px 36px 0;"><img src="${productImage}" alt="${productName}" style="max-width:100%;max-height:260px;object-fit:contain;border-radius:8px;" /></div>`
    : '';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">

    <div style="background:#111;padding:32px 36px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px;">🎁</div>
      <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Your deal is waiting</div>
      <div style="color:#e55;font-size:13px;font-weight:600;margin-top:6px;">Hurry — this price expires in 15 minutes</div>
    </div>

    ${imgBlock}

    <div style="padding:32px 36px;">
      <div style="font-size:13px;color:#888;margin-bottom:4px;">${productName}</div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px;">
        <span style="font-size:36px;font-weight:800;color:#111;">$${dealPrice}</span>
        <span style="font-size:16px;color:#bbb;text-decoration:line-through;">$${Math.round(listPrice)}</span>
      </div>
      <div style="display:inline-block;background:#f0fdf4;color:#166534;font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;margin-bottom:24px;">
        You saved $${saved} &middot; ${savedPct}% off
      </div>

      ${discountCode ? `<div style="background:#f9f9f9;border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:12px;color:#666;">
        Discount code <strong style="color:#111;font-family:monospace;">${discountCode}</strong> applied automatically at checkout
      </div>` : ''}

      <a href="${checkoutUrl}" style="display:block;background:#111;color:#fff;text-align:center;padding:16px;border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-0.2px;">
        Complete my order →
      </a>

      <div style="text-align:center;margin-top:16px;font-size:12px;color:#bbb;">
        This price expires soon — don't miss it
      </div>
    </div>

    <div style="border-top:1px solid #f0f0f0;padding:20px 36px;text-align:center;">
      <div style="font-size:11px;color:#ccc;">Powered by <a href="https://botiga.ai" style="color:#ccc;">botiga.ai</a></div>
    </div>
  </div>
</body>
</html>`.trim();

  try {
    if (brevo) {
      const SibApiV3Sdk = require('@getbrevo/brevo');
      const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
      sendSmtpEmail.subject = subject;
      sendSmtpEmail.htmlContent = html;
      sendSmtpEmail.sender = { name: FROM_NAME, email: FROM };
      sendSmtpEmail.to = [{ email: to }];
      await brevo.sendTransacEmail(sendSmtpEmail);
    } else if (resend) {
      await resend.emails.send({ from: `${FROM_NAME} <${FROM}>`, to, subject, html });
    } else if (nodemailerTransport) {
      await nodemailerTransport.sendMail({
        from: `${FROM_NAME} <${FROM}>`,
        to,
        subject,
        html,
        replyTo: process.env.REPLY_TO_EMAIL || FROM
      });
    }
    console.log('[Email] Deal email sent to', to);
  } catch (err) {
    console.error('[Email] Failed to send deal email:', err.message);
  }
}

module.exports = { sendDealEmail };
