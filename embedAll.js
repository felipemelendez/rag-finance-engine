/**
 * Here we create a unified vector-search layer for the entire financial dataset.
 * For every row in a curated list of Supabase tables, this script:
 *
 *   1. **Serialises** the row into a deterministic, human-readable fact string.
 *   2. **Embeds** that string into a float vector via the OpenAI Embeddings API.
 *   3. **Upserts** the vector plus source metadata into the `documents` table.
 *
 * RATIONALE
 * ---------
 * Retrieval-Augmented Generation (RAG) systems are only as reliable as the
 * vectors they retrieve.  Three pitfalls shape the design of this pipeline:
 *
 * • **Opaque identifiers** – Vectors that contain only UUIDs or foreign-key
 *   columns (“account_id=...”) hide meaning.  By enriching snapshots with the
 *   *name* and *type* of the account (“Main Checking, cash”), we anchor each
 *   embedding in language the model—and our teammates—can understand.
 *
 * • **Lack of semantic anchors** – Embeddings match *words*, not invisible
 *   schema.  If the serialised string never mentions *cash*, *expense*, or the
 *   friendly column name, a query for “cash balance” or “burn rate” may never
 *   surface that row.  Explicit, readable fields ensure the right vectors get
 *   recalled.
 *
 * • **Precision vs. vector noise** – Finance demands exact numbers, yet
 *   embeddings optimise for semantic similarity, not numeric accuracy.  By
 *   embedding *individual* snapshots and transactions—rather than huge blobs—
 *   we reduce noise and raise the odds that the exact fact we need appears in
 *   the top-k results.
 *
 * WHY THIS MATTERS
 * --------------
 * • **Semantic queries across relational data** – A single vector store lets
 *   LLMs answer questions that cut across tables (“Which vendors do we still
 *   owe money?”).
 * • **Explainability** – The serialised fact string doubles as a readable
 *   snippet to display alongside search results.
 * • **Data lineage** – `(source_table, source_id)` allows us to trace every
 *   vector back to the row that produced it.
 * • **Idempotence** – Upserts ensure exactly one vector per row, so we can
 *   re-run the script safely (e.g. nightly or after schema changes).
 *
 * EXECUTION MODEL
 * ---------------
 *   • Runs serially, keeping logs deterministic and well within API limits.
 *   • Can be invoked manually, by CI, or as a Supabase Edge Function.
 *   • Service-role key is required; restrict execution to back-end contexts.
 *
 * Usage:  `node embedAll.js`
 * ============================================================================
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

/** Supabase client with service-role privileges (server-side only). */
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** Shared OpenAI SDK instance (reads OPENAI_API_KEY from env). */
const openai = new OpenAI();

/* -------------------------------------------------------------------------- */
/* 1) Embedding utility                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Produce a vector embedding for an arbitrary piece of text.
 *
 * Centralising this call lets us layer in batching, retries, or model swaps
 * without changing downstream logic.
 *
 * @async
 * @param {string} text – Plain-text sentence to embed.
 * @returns {Promise<number[]>} Float32 vector produced by the model.
 */
async function makeEmbedding(text) {
    const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float',
    });
    return res.data[0].embedding;
}

/* -------------------------------------------------------------------------- */
/* 2) Serialisation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Turn a DB row into a deterministic, pipe-delimited fact string.
 *
 * Bespoke templates add clarity (e.g. account snapshots get the account’s
 * name/type).  For all other tables we fall back to a generic KEY=VALUE list,
 * omitting noisy fields such as `metadata` and audit timestamps.
 *
 * @async
 * @param {string} table – Source table name.
 * @param {Object} row   – Row object returned by Supabase.
 * @returns {Promise<string>} Human-readable description of the row.
 */
async function serialize(table, row) {
    if (table === 'account_snapshots') {
        // Enrich snapshot with account metadata for clearer semantics.
        const { data: acct, error: acctErr } = await supabaseAdmin
            .from('accounts')
            .select('name, type')
            .eq('id', row.account_id)
            .single();
        if (acctErr) throw acctErr;

        return (
            `Account Balance | account_name="${acct.name}" | ` +
            `account_type="${acct.type}" | as_of="${row.snapshot_date}" | ` +
            `cash_balance=${row.balance}`
        );
    }

    if (table === 'monthly_expense_snapshots') {
        return (
            `Monthly Expense Snapshot | ` +
            `period="${row.period_start} to ${row.period_end}" | ` +
            `total_expense=${row.total_expense}`
        );
    }

    if (table === 'financial_kb') {
        return `Formula | title="${row.title}" | expression="${row.content}"`;
    }

    // Generic fallback: stringify every relevant field.
    const fields = Object.entries(row)
        .filter(([k]) => !['metadata', 'updated_at'].includes(k))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' | ');

    return `${table.toUpperCase()} | ${fields}`;
}

/* -------------------------------------------------------------------------- */
/* 3) Per-table processing                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Embed every row of a specific table and upsert results into `documents`.
 *
 * @async
 * @param {string} table – Table to process.
 */
async function embedTable(table) {
    console.log(`⏳ Embedding ${table}...`);
    const { data: rows, error } = await supabaseAdmin.from(table).select('*');
    if (error) throw error;

    for (const row of rows) {
        const content = await serialize(table, row);
        const embedding = await makeEmbedding(content);

        const { error: upsertErr } = await supabaseAdmin
            .from('documents')
            .upsert(
                {
                    user_id: row.user_id,
                    source_table: table,
                    source_id: row.id,
                    content,
                    embedding,
                },
                { onConflict: ['source_table', 'source_id'] }
            );
        if (upsertErr) throw upsertErr;
        console.log(`📝  ${table} ${row.id}`);
    }
}

/* -------------------------------------------------------------------------- */
/* 4) Orchestration                                                           */
/* -------------------------------------------------------------------------- */

const TABLES_TO_EMBED = [
    'profiles',
    'accounts',
    'categories',
    'transactions',
    'budgets',
    'customers',
    'invoices',
    'vendors',
    'bills',
    'account_snapshots',
    'monthly_expense_snapshots',
    'financial_kb',
];

/**
 * Sequentially process every table in `TABLES_TO_EMBED`.
 *
 * Serial execution is deterministic (helpful for audit logs) and stays within
 * rate limits by default.  If throughput becomes the bottleneck we can
 * parallelise at the table level or introduce batch embeddings.
 */
async function run() {
    for (const table of TABLES_TO_EMBED) {
        await embedTable(table);
    }
    console.log('✅ All embeddings inserted');
}

/* -------------------------------------------------------------------------- */
/* 5) Entrypoint                                                              */
/* -------------------------------------------------------------------------- */

run().catch((err) => {
    console.error('❌ Embedding failed:', err);
    process.exit(1);
});
