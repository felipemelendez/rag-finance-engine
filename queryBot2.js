/**
 * queryBot.js
 *
 * CLI: `node queryBot.js "Your question"`
 * Fetches the user’s embeddings via RPC(match_documents),
 * then calls the LLM with system + context + user prompt.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const USER_ID = process.env.DUMMY_USER_ID;

async function greet() {
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('name')
        .eq('id', USER_ID)
        .single();
    if (error) throw error;
    console.log(`👋 Hello ${data?.name || 'there'}!`);
}

async function embed(text) {
    const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float',
    });
    return res.data[0].embedding;
}

async function fetchContext(question) {
    const qvec = await embed(question);
    const { data, error } = await supabaseAdmin.rpc('match_documents', {
        p_user_id: USER_ID,
        query_embedding: qvec,
        match_threshold: 0.1,
        match_count: 8,
    });
    if (error) throw error;
    return data.map((r) => r.content).join('\n---\n');
}

async function answer(question) {
    const ctx = await fetchContext(question);
    const messages = [
        {
            role: 'system',
            content: [
                'You are a financial assistant. Answer *only* from provided context. ',
                'If out of scope, reply: “I can only answer finance questions based on the provided data.”',
            ].join(''),
        },
        { role: 'system', content: ctx },
        { role: 'user', content: question },
    ];
    const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0,
        max_tokens: 500,
    });
    return resp.choices[0].message.content.trim();
}

async function main() {
    await greet();
    const question = process.argv.slice(2).join(' ');
    if (!question) {
        console.error('Usage: node queryBot.js "Your question"');
        process.exit(1);
    }
    const reply = await answer(question);
    console.log('\n📊 Answer:\n', reply);
}

main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});
