const twilio = require('twilio');
const { Resend } = require('resend');
const supabase = require('../lib/supabase');

async function sendWhatsApp(to, message) {
  if (!process.env.TWILIO_ACCOUNT_SID) return;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: `whatsapp:${to}`,
    body: message
  });
}

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send({
    from: 'Botiga <noreply@botiga.ai>',
    to,
    subject,
    html
  });
}

async function sendStep2Recovery(negotiation) {
  const message = `Hey! Your negotiated price of $${negotiation.deal_price} on ${negotiation.product_name} expires in 1 hour ⏰\n\nTap to complete your order → ${negotiation.checkout_url}`;

  try {
    if (negotiation.customer_whatsapp) {
      await sendWhatsApp(negotiation.customer_whatsapp, message);
    }
    if (negotiation.customer_email) {
      await sendEmail(
        negotiation.customer_email,
        `Your deal on ${negotiation.product_name} expires soon!`,
        `<p>${message.replace(/\n/g, '<br>')}</p>`
      );
    }

    await supabase.from('recovery_attempts').insert({
      negotiation_id: negotiation.id,
      step: 2,
      channel: negotiation.customer_whatsapp ? 'whatsapp' : 'email',
      sent_at: new Date().toISOString()
    });

    await supabase.from('negotiations').update({
      recovery_sent_at: new Date().toISOString()
    }).eq('id', negotiation.id);
  } catch (err) {
    console.error('[Recovery] Step 2 failed for', negotiation.id, err.message);
  }
}

async function sendStep3Recovery(negotiation) {
  const message = `Last chance on that ${negotiation.product_name}! If $${negotiation.deal_price} didn't feel right, reply with what works for you and I'll see what I can do 🙏`;

  try {
    if (negotiation.customer_whatsapp) {
      await sendWhatsApp(negotiation.customer_whatsapp, message);
    }
    if (negotiation.customer_email) {
      await sendEmail(
        negotiation.customer_email,
        `Last chance on your ${negotiation.product_name} deal`,
        `<p>${message.replace(/\n/g, '<br>')}</p>`
      );
    }

    await supabase.from('recovery_attempts').insert({
      negotiation_id: negotiation.id,
      step: 3,
      channel: negotiation.customer_whatsapp ? 'whatsapp' : 'email',
      sent_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Recovery] Step 3 failed for', negotiation.id, err.message);
  }
}

// Run by cron every 15 minutes
async function processRecoveryQueue() {
  const now = new Date();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // Step 2: pending negotiations older than 2h, not yet sent
  const { data: step2Candidates } = await supabase
    .from('negotiations')
    .select('*')
    .eq('status', 'pending')
    .is('recovery_sent_at', null)
    .lt('created_at', twoHoursAgo)
    .not('customer_whatsapp', 'is', null);

  for (const neg of (step2Candidates || [])) {
    await sendStep2Recovery(neg);
  }

  // Step 3: still pending after 24h, step 2 already sent
  const { data: step3Candidates } = await supabase
    .from('negotiations')
    .select('*')
    .eq('status', 'pending')
    .not('recovery_sent_at', 'is', null)
    .lt('created_at', twentyFourHoursAgo);

  // Filter: only those where no step 3 attempt exists
  for (const neg of (step3Candidates || [])) {
    const { data: existing } = await supabase
      .from('recovery_attempts')
      .select('id')
      .eq('negotiation_id', neg.id)
      .eq('step', 3)
      .single();

    if (!existing) {
      await sendStep3Recovery(neg);
    }
  }
}

module.exports = { processRecoveryQueue, sendStep2Recovery, sendStep3Recovery };
