// countDocs.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function countDocuments() {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
    );
    // head:true tells Supabase not to actually fetch rows
    const { count, error } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true });
    if (error) {
        console.error('Error counting documents:', error.message);
        process.exit(1);
    }
    console.log(`📄 documents table has ${count} rows`);
}

countDocuments();
