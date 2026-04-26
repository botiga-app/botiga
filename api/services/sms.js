async function sendDealSms({ to, productName, dealPrice, discountCode, checkoutUrl }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    console.warn('[SMS] Twilio not configured — skipping SMS');
    return;
  }

  const body = [
    `🎉 Your deal is locked in!`,
    `${productName}: $${parseFloat(dealPrice).toFixed(2)}`,
    `Use code ${discountCode} at checkout:`,
    checkoutUrl
  ].join('\n');

  const params = new URLSearchParams({ To: to, From: from, Body: body });

  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString()
      }
    );
    const data = await resp.json();
    if (!resp.ok) console.error('[SMS] Twilio error:', data.message);
    return data;
  } catch (err) {
    console.error('[SMS] Send failed:', err.message);
  }
}

module.exports = { sendDealSms };
