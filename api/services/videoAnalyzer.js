// Vision + caption analyzer for shoppable videos.
//
// Given a video row (with thumbnail_url + caption from IG/TikTok import),
// call Groq Llama 3.2 Vision to identify the product shown, returning
// structured fields that matchCatalog.findBestMatch can score against
// the merchant's catalog.
//
// Why thumbnail-only (not ffmpeg frame extraction) in v1: a single image
// hits the same Groq vision endpoint as 5 frames would in a more elaborate
// pipeline, but in 1 call instead of 5. For shoppable IG reels where the
// product is the focus, the thumbnail is almost always representative.
// We can upgrade to multi-frame later if accuracy proves insufficient.
//
// Returned shape (one product per video; videos with multiple products
// emit the most prominent one):
//   { title, color, category, description, sizes, confidence }
// where confidence is 0..1 — the analyzer's belief that there's a real
// identifiable product in the video. Caller applies threshold policy.

const GROQ_VISION_MODEL = 'llama-3.2-90b-vision-preview';
const GROQ_TEXT_MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `You analyze a single image (a shoppable video thumbnail) plus the merchant's IG caption to identify the primary product being shown.

Return JSON ONLY. Schema:
{
  "title": "Short product name (e.g. 'Linen Midi Dress')",
  "color": "primary color (e.g. 'beige', 'navy') or null",
  "category": "dress|top|bottom|jewelry|bag|shoes|accessory|outerwear|swimwear|loungewear|other",
  "description": "1-2 sentence neutral description of the product",
  "sizes": ["XS","S","M","L","XL"],   // sizes mentioned in caption; empty array if none
  "price": null,                       // dollars number if mentioned in caption; otherwise null
  "confidence": 0.0_to_1.0,
  "reasoning": "1-sentence why you picked this confidence"
}

Confidence rubric:
- 0.85-1.0  : Clear product, distinctive features, caption confirms
- 0.6-0.85  : Product visible but caption ambiguous OR caption clear but image partial
- 0.3-0.6   : Multiple possible products / generic shot / vague caption
- 0.0-0.3   : Lifestyle shot with no clear product / behind-the-scenes / unclear what's being sold

Rules:
- The "title" should be specific enough to match against a Shopify catalog. "Black dress" is too generic; "Black satin slip dress" is better. If you can't name it specifically, drop confidence.
- Don't invent details not in the image or caption.
- "Lifestyle" or "behind-the-scenes" shots without a focus product → confidence < 0.3.`;

async function callGroqVision(imageUrl, caption) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');

  const userContent = [
    { type: 'image_url', image_url: { url: imageUrl } },
    {
      type: 'text',
      text: caption
        ? `Caption: "${caption.slice(0, 500)}"\n\nIdentify the primary product per the schema in the system prompt.`
        : 'No caption provided. Identify the product per the schema.',
    },
  ];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq Vision ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Empty response from Groq Vision');

  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error('Groq Vision returned non-JSON: ' + raw.slice(0, 200)); }
  return parsed;
}

// Caption-only fallback when no thumbnail is available — uses the text
// model since vision needs an image. Lower confidence ceiling (0.7 max)
// because we can't visually verify.
async function callGroqTextOnly(caption) {
  if (!caption || !process.env.GROQ_API_KEY) return null;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_TEXT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + '\n\nNOTE: No image is available. Cap confidence at 0.7 since you cannot visually verify.' },
        { role: 'user', content: `Caption: "${caption.slice(0, 500)}"\n\nIdentify the product per the schema.` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (p.confidence != null) p.confidence = Math.min(0.7, p.confidence);
    return p;
  } catch { return null; }
}

/**
 * @param video  videos row — needs { id, thumbnail_url?, source_url?, ... }
 *               and the IG caption (we'll look up `title` field from videos
 *               which the import flow stores as the caption preview).
 * @returns { title, color, category, description, sizes, price, confidence, reasoning }
 *          or null if neither vision nor caption analysis produced anything usable.
 */
async function analyzeVideo(video) {
  const caption = video.title || video.caption || '';
  const thumbnail = video.thumbnail_url || null;

  if (thumbnail) {
    try {
      return await callGroqVision(thumbnail, caption);
    } catch (err) {
      console.warn(`[videoAnalyzer] vision call failed for ${video.id}: ${err.message}; falling back to caption-only`);
      return await callGroqTextOnly(caption);
    }
  }

  return await callGroqTextOnly(caption);
}

module.exports = { analyzeVideo };
