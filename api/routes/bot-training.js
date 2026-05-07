// Bot training CRUD — owner instructions that feed both the LLM prompt
// and the deterministic product scorer. The dashboard renders these as
// a simple list with a text input. Each save runs the instruction
// through Groq once to extract structured directives.

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { dashboardCors } = require('../middleware/cors');
const { parseInstructionToDirectives } = require('../services/botInstructions');

// CORS is applied per-route below — DON'T use `router.use(dashboardCors)`
// because Express runs that middleware on every request that traverses
// this router, including unrelated paths like /api/widget/videos that
// happen to be mounted under the same /api prefix. dashboardCors's strict
// origin check then 500s the storefront widget. Per-route is scoped.

// List instructions for a merchant — newest first.
router.get('/merchants/:merchantId/bot-instructions', dashboardCors, async (req, res) => {
  const { merchantId } = req.params;
  const { data, error } = await supabase
    .from('bot_instructions')
    .select('id, instruction_text, directives, active, priority, expires_at, created_at, updated_at')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ instructions: data || [] });
});

// Create a new instruction. Parses to directives at save time so the
// LLM call cost is paid once per save instead of per page-load.
router.post('/merchants/:merchantId/bot-instructions', dashboardCors, async (req, res) => {
  const { merchantId } = req.params;
  const { instruction_text, expires_at, priority = 0 } = req.body || {};
  if (!instruction_text || !String(instruction_text).trim()) {
    return res.status(400).json({ error: 'instruction_text required' });
  }
  const text = String(instruction_text).trim().slice(0, 500);

  let directives = [];
  try {
    directives = await parseInstructionToDirectives(text);
  } catch (err) {
    console.warn('[bot-instructions] parse failed:', err.message);
  }

  const { data, error } = await supabase
    .from('bot_instructions')
    .insert({
      merchant_id: merchantId,
      instruction_text: text,
      directives,
      active: true,
      priority,
      expires_at: expires_at || null,
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Toggle active / update priority / set expiry / re-edit text.
// Re-parsing happens only if the text actually changed.
router.patch('/bot-instructions/:id', dashboardCors, async (req, res) => {
  const id = req.params.id;
  const { active, priority, expires_at, instruction_text } = req.body || {};

  const updates = { updated_at: new Date().toISOString() };
  if (typeof active === 'boolean') updates.active = active;
  if (typeof priority === 'number') updates.priority = priority;
  if (expires_at !== undefined) updates.expires_at = expires_at || null;

  if (instruction_text != null) {
    const trimmed = String(instruction_text).trim().slice(0, 500);
    if (trimmed) {
      updates.instruction_text = trimmed;
      try {
        updates.directives = await parseInstructionToDirectives(trimmed);
      } catch (err) {
        console.warn('[bot-instructions] re-parse failed:', err.message);
      }
    }
  }

  const { data, error } = await supabase
    .from('bot_instructions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Hard delete. We don't soft-delete because owners often want clean
// history, and the dashboard already supports active=false for "pause".
router.delete('/bot-instructions/:id', dashboardCors, async (req, res) => {
  const { error } = await supabase
    .from('bot_instructions')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
