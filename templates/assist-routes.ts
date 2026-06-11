/**
 * /api/assist — the ask-the-app assistant.
 *
 * Same Gemma model as everything else, text-only, thinking OFF (structured
 * support answers, not open reasoning — see CLAUDE.md pitfalls). The system
 * prompt is the app guide in knowledge.ts; the model is told to answer only
 * from it. EVERY question is logged to D1, success or failure — the question
 * log is the roadmap.
 */
import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { questions, type Tenant } from '@/server/db/schema';
import { VISION_MODEL } from '@/shared/config/constants';
import { coerceToString } from '@/server/lib/vision';
import { checkRateLimit } from '@/server/lib/rate-limit';
import { APP_GUIDE } from './knowledge';
import type { Env, Variables } from '@/server/index';

export const assistRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_QUESTION_CHARS = 500;

assistRoutes.post('/assist/ask', async (c) => {
  const tenant = c.get('tenant') as Tenant;

  // Shared tenant bucket — an authed user asking questions shouldn't be able
  // to burn unbounded AI calls, but the normal limits are generous enough.
  const rl = await checkRateLimit(c.env.CACHE, `assist:${tenant.id}`);
  if (!rl.ok) {
    return c.json({ error: 'Too many questions — try again shortly', code: 'RATE_LIMITED' }, 429);
  }

  let body: { question?: string; pagePath?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }
  const question = (body.question ?? '').trim();
  const pagePath = (body.pagePath ?? '').slice(0, 200) || null;
  if (!question) {
    return c.json({ error: 'question is required', code: 'MISSING_FIELD' }, 400);
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return c.json(
      { error: `Question too long (max ${MAX_QUESTION_CHARS} characters)`, code: 'INVALID_FIELD' },
      400
    );
  }

  const askedBy = c.get('sessionUserEmail') ?? 'api-key';
  const id = nanoid();
  const db = drizzle(c.env.DB);
  const start = Date.now();

  const messages = [
    {
      role: 'system',
      content:
        `You are the in-app guide for FieldProof, answering a signed-in office user's question. ` +
        `Answer ONLY from the app guide below. If the guide doesn't cover it, say so plainly and ` +
        `point them to Jeremy (contact details are in the guide) — never invent features, prices, ` +
        `or behaviour. Be concrete and brief: plain text, short dashed lists where they help, no ` +
        `markdown headings, under 120 words. When a page is relevant, name it the way the nav ` +
        `does (e.g. "the Runs page").\n\n--- APP GUIDE ---\n${APP_GUIDE}`,
    },
    {
      role: 'user',
      content: `${pagePath ? `(Asked from the ${pagePath} page.)\n` : ''}${question}`,
    },
  ];

  let answer: string | null = null;
  let errorMessage: string | null = null;
  try {
    // Thinking OFF — Gemma's thinking mode burns the token budget on
    // text-only calls and returns null content (CLAUDE.md pitfalls).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await c.env.AI.run(VISION_MODEL as any, {
      messages,
      max_tokens: 1024,
      chat_template_kwargs: { enable_thinking: false, thinking: false },
    } as any)) as unknown;
    answer = coerceToString(result).trim() || null;
    if (!answer) errorMessage = 'Empty answer from model';
  } catch (err) {
    errorMessage = String(err);
  }

  const latencyMs = Date.now() - start;

  // Log regardless of outcome — failed questions are still signal.
  await db.insert(questions).values({
    id,
    tenantId: tenant.id,
    question,
    answer,
    pagePath,
    askedBy,
    modelUsed: VISION_MODEL,
    latencyMs,
    errorMessage,
  });

  if (!answer) {
    console.error(JSON.stringify({ event: 'assist_failed', id, error: errorMessage }));
    return c.json(
      { error: 'The guide could not answer right now — try again in a moment', code: 'ASSIST_FAILED' },
      502
    );
  }

  console.info(JSON.stringify({ event: 'assist_answered', id, latencyMs, askedBy }));
  return c.json({ id, answer });
});

assistRoutes.get('/assist/questions', async (c) => {
  const tenant = c.get('tenant') as Tenant;
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 100)));
  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(questions)
    .where(eq(questions.tenantId, tenant.id))
    .orderBy(desc(questions.createdAt))
    .limit(limit);
  return c.json({ questions: rows });
});
