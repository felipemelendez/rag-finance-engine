// embedAll.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const tables = [
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
    'financial_kb', // for the financial knowledge base
];

// 1) Connect with your SERVICE ROLE key so you can insert into documents
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// 2) OpenAI client
const openai = new OpenAI();

// 3) Your embedding function
async function generateEmbeddings(input) {
    const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input,
        encoding_format: 'float',
    });
    return res.data[0].embedding;
}

// 4) Serialize a record into a text blob
function serialize(table, rec) {
    if (table === 'financial_kb') {
        return `KB: ${rec.title} — ${rec.content}`;
    }
    return (
        table.toUpperCase() +
        ': ' +
        Object.entries(rec)
            .filter(([k]) => k !== 'metadata' && k !== 'embedding')
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join('; ')
    );
}

// 5) Embed every row in a given table
async function embedTable(tableName) {
    // a) Fetch all rows
    const { data: rows, error: fetchErr } = await supabase
        .from(tableName)
        .select('*');
    if (fetchErr)
        throw new Error(`Fetch ${tableName} error: ${fetchErr.message}`);

    // b) For each row, generate & insert embedding
    for (const rec of rows) {
        const content = serialize(tableName, rec);
        const vector = await generateEmbeddings(content);

        const { error: upsertErr } = await supabase.from('documents').upsert(
            {
                user_id: rec.user_id,
                source_table: tableName,
                source_id: rec.id,
                content,
                embedding: vector,
            },
            { onConflict: ['source_table', 'source_id'] }
        );
        if (upsertErr)
            throw new Error(
                `Upsert doc for ${tableName} ${rec.id}: ${upsertErr.message}`
            );

        console.log(`📝 Upserted ${tableName} ${rec.id}`);
    }
}

// 6) Run embedding for each table in order
async function run() {
    for (const table of tables) {
        await embedTable(table);
    }
    console.log('✅ All embeddings stored in documents');
}

run().catch((err) => {
    console.error('❌ Embedding failed:', err.message);
    process.exit(1);
});
