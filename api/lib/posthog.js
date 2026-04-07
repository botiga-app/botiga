const { PostHog } = require('posthog-node');

const posthog = process.env.POSTHOG_API_KEY
  ? new PostHog(process.env.POSTHOG_API_KEY, { host: 'https://app.posthog.com' })
  : null;

async function trackLLMCall({ merchantId, negotiationId, provider, model, inputTokens, outputTokens, latencyMs, costUsd }) {
  if (!posthog) return;
  posthog.capture({
    distinctId: merchantId,
    event: 'llm_call',
    properties: {
      negotiation_id: negotiationId,
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
      cost_usd: costUsd
    }
  });
}

async function trackNegotiationEvent({ merchantId, negotiationId, event, properties = {} }) {
  if (!posthog) return;
  posthog.capture({
    distinctId: merchantId,
    event,
    properties: {
      negotiation_id: negotiationId,
      ...properties
    }
  });
}

module.exports = { posthog, trackLLMCall, trackNegotiationEvent };
