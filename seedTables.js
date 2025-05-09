import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
    accounts,
    categories,
    transactions,
    budgets,
    customers,
    invoices,
    vendors,
    bills,
} from './seedData.js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

async function seedAll() {
    await supabase.from('accounts').insert(accounts);
    await supabase.from('categories').insert(categories);
    await supabase.from('transactions').insert(transactions);
    await supabase.from('budgets').insert(budgets);
    await supabase.from('customers').insert(customers);
    await supabase.from('invoices').insert(invoices);
    await supabase.from('vendors').insert(vendors);
    await supabase.from('bills').insert(bills);
    console.log('✅ Seed tables complete');
}

seedAll().catch(console.error);
