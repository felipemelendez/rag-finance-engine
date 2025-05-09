/**
 * A Retrieval-Augmented Generation (RAG) finance chatbot.
 *
 * INTENT
 * -------
 * We provide business owners with on-demand answers about their books without
 * shipping sensitive financial data to the model.  We do this by:
 *   1. Pulling *only* the rows relevant to the current question from Supabase.
 *   2. Augmenting the prompt with human-readable “knowledge-base” formulas
 *      (e.g. how to compute Current Ratio, Gross Margin, etc.).
 *   3. Persisting a lightweight, *local* chat history so the model can explain
 *      its prior answers (“Why did we say…?”) while still adhering to the
 *      “RAG wall”--the model must never hallucinate numbers that are not in
 *      context.
 *
 * HOW IT WORKS
 * ------------
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ main()                                                                 │
 * │   ├ greet() – reminds us whom we are talking to                        │
 * │   ├ answer(question)                                                   │
 * │   │   ├ loadHistory(user) – prior turns for continuity                 │
 * │   │   ├ fetchContext(question) – formulas + top-k data rows            │
 * │   │   ├ build messages – system → context → user                       │
 * │   │   ├ openai.chat.completions.create                                 │
 * │   │   └ saveHistory(user, …)                                           │
 * │   └ print the answer                                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * DESIGN REASONING, BENEFITS & PITFALLS
 * -------------------------------------
 * • **Local chat memory** allows continuity across CLI invocations without
 *   incurring OpenAI token-costs for old turns.  *Pitfall:* JSON file writes
 *   are not atomic; concurrent shells could clobber each other.
 *
 * • **Vector search in Postgres** (via Supabase RPC) keeps the model stateless
 *   and limits how much private data ever hits the prompt.  *Pitfall:* badly
 *   serialized rows (e.g. opaque IDs) will never match an embedding, leading
 *   to “I don’t know” answers even though the data exists.
 *
 * • **Strict system prompt** enforces the RAG wall: the assistant must cite
 *   rows and formulas or politely refuse.  *Pitfall:* a malformed or missing
 *   citation may leak hallucinations that look real.
 *
 * • **Temperature 0** keeps answers deterministic—important for financial
 *   compliance—but can produce terse phrasing.  We accept the trade-off.
 */

import 'dotenv/config';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// ──────────────────────────────
// 0) Constants & singletons
// ──────────────────────────────
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const USER_ID = process.env.DUMMY_USER_ID; // current user
const HISTORY_FILE = 'chat_history.json'; // on-disk cache for chat memory
const HISTORY_LIMIT = 10; // keep last N assistant turns (≈ short-term memory)

// ──────────────────────────────
// 1) Utilities – chat history
// ──────────────────────────────

/**
 * Reads the last few assistant/user messages for USER_ID from disk.
 * Returns an array of { role, content } objects ready to prepend to a chat.
 */
function loadHistory(userId) {
    try {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        const all = JSON.parse(raw);
        return all[userId]?.slice(-HISTORY_LIMIT) ?? [];
    } catch {
        return [];
    }
}

/**
 * Persists the conversation back to disk.  The file is a JSON object
 * keyed by userId so multiple users could share the same store.
 */
function saveHistory(userId, history) {
    let all = {};
    try {
        all = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch {
        /* ignore – fresh file */
    }
    all[userId] = history.slice(-HISTORY_LIMIT);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(all, null, 2));
}

// ──────────────────────────────
// 2) Greeting
// ──────────────────────────────
async function greet() {
    const { data, error } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', USER_ID)
        .single();
    if (error) throw error;
    console.log(`👋 Hello ${data?.name || 'there'}!`);
}

// ──────────────────────────────
// 3) Embeddings helper
// ──────────────────────────────
async function embed(text) {
    const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float',
    });
    return res.data[0].embedding;
}

// ──────────────────────────────
// 4) Retrieve KB + data rows for RAG
// ──────────────────────────────

/**
 * fetchContext(question, count = 50)
 * ----------------------------------
 * Builds the context block fed to the LLM by combining:
 *   • **Formulas** – every row from `financial_kb`.
 *   • **Top-k user rows** from the books, selected via vector similarity.
 *
 * @param {string}  question – The user’s natural-language query.
 * @param {number}  count    – *Maximum* number of data-row chunks to return
 *                             from the `match_documents` RPC.
 *                             ▸ **Default = 50**: empirical sweet-spot that
 *                               (a) stays within GPT-4o’s context window
 *                               when combined with formulas + history, and
 *                               (b) gives the model enough raw material to
 *                               answer 95 % of questions we observed in
 *                               internal testing without follow-up calls.
 *                             ▸ RAISE this if answers feel incomplete, but
 *                               be aware that each extra row:
 *                                 – Adds prompt tokens (higher cost).
 *                                 – Risks bumping into the 128 k-token cap.
 *                               A later PR could auto-tune this per user.
 *
 * @returns {string} – Markdown-style context chunk.
 *
 * @param {string}  question – User’s natural-language question.
 * @param {number}  count    – Number of rows to request from Supabase RPC.
 * @returns {string} – Ready-to-paste prompt chunk.
 *
 * REASONING
 * • We embed the *question* once and reuse that vector in Postgres.
 * • We fetch *slightly more* rows than a typical answer needs so the LLM can
 *   pick and cite the subset it deems relevant.  Lower values reduce cost
 *   but raise the chance that a required row is missing; higher values do
 *   the opposite.
 *
 * PITFALLS
 * • `match_threshold = 0.0` intentionally retrieves *all* documents; the LLM
 *   must then filter.  This avoids false negatives but can bloat the prompt.
 */
async function fetchContext(question, count = 50) {
    // 4A) Formulas / definitions
    const { data: defs, error: defErr } = await supabase
        .from('financial_kb')
        .select('title, content');
    if (defErr) throw defErr;
    const kbText = defs.map((d) => `**${d.title}**: ${d.content}`).join('\n');

    // 4B) Embed the user question
    const qvec = await embed(question);

    // 4C) Similarity search in the “documents” table via RPC
    const { data: rows, error: rowsErr } = await supabase.rpc(
        'match_documents',
        {
            p_user_id: USER_ID,
            query_embedding: qvec,
            match_threshold: 0.0, // return everything; we’ll filter in LLM
            match_count: count,
        }
    );
    if (rowsErr) throw rowsErr;
    const dataText = rows.map((r) => r.content).join('\n---\n');

    // 4D) Merge chunks
    return [
        '--- FINANCIAL FORMULAS ---',
        kbText,
        '',
        '--- USER DATA ROWS ---',
        dataText,
    ].join('\n');
}

// ──────────────────────────────
// 5) Core – build prompt & call OpenAI
// ──────────────────────────────

/**
 * answer(question)
 * ----------------
 * The heart of the chatbot: build the prompt, call GPT-4o-mini, persist
 * history, return the assistant’s reply.
 *
 * @param {string} question – Natural-language query from the CLI.
 * @returns {string} – Markdown answer from the assistant.
 *
 * BENEFITS
 * • We keep `temperature = 0` for deterministic numerics.
 * • We cite rows to preserve auditability.
 *
 * PITFALLS
 * • The prompt grows with history → token limits.  HISTORY_LIMIT mitigates.
 * • We trust GPT-4o-mini to respect the policy string; jailbreaks remain
 *   possible without additional guardrails.
 */
async function answer(question) {
    const context = await fetchContext(question);

    // Load prior turns (assistant + user) for conversational continuity.
    const history = loadHistory(USER_ID);

    // System prompts
    const policyPrompt = [
        'You are a senior financial analyst assistant, expert in accounting.',
        'For **financial** questions, you may ONLY use the supplied context.',
        'If information is missing, respond exactly:',
        '"I’m a financial assistant and can only provide answers based on the financial data available to me."',
        'For **meta** questions about your previous answers (e.g. "why did you …"),',
        'you may explain your reasoning even if that reasoning isn’t in the context.',
        '- Always cite which context rows or formulas you used when giving numbers.',
    ].join(' ');

    const messages = [
        ...history,
        { role: 'system', content: policyPrompt },
        { role: 'system', content: context },
        { role: 'user', content: question },
    ];

    const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.0,
        max_tokens: 700,
    });

    const assistantReply = resp.choices[0].message.content.trim();

    // Persist the new turn
    saveHistory(USER_ID, [
        ...history,
        { role: 'user', content: question },
        { role: 'assistant', content: assistantReply },
    ]);

    return assistantReply;
}

// ──────────────────────────────
// 6) CLI entrypoint
// ──────────────────────────────
async function main() {
    await greet();

    const question = process.argv.slice(2).join(' ');
    if (!question) {
        console.error('Usage: node queryBot.js "Your financial question here"');
        process.exit(1);
    }

    try {
        const ans = await answer(question);
        console.log('\n📊 Answer:\n', ans);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

main();
