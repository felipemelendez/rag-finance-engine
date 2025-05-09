/**
 * This script seeds a Supabase project with realistic demo data for a small
 * business so that the RAG‑powered finance chatbot has something meaningful
 * to query against.  It inserts a minimal user profile plus double‑entry style
 * transactions, budgets, A/R and A/P documents, account snapshots, and a
 * financial knowledge‑base glossary.  The data is deterministic and idempotent
 * so we can safely re‑run the script; on each run existing rows are upserted
 * or recreated and the rest of the rows are appended.
 *
 * Design & How it works
 * ---------------------
 * 1. The Supabase **service‑role** key is used so the script has unrestricted
 *    access to all tables—do **NOT** ship this code to the client.
 * 2. The `DUMMY_USER` constant represents one demo user.  All rows created by
 *    this script are tagged with this `user_id` so they remain isolated from
 *    real production data.
 * 3. The script is broken into logical phases that roughly follow an
 *    accounting workflow:
 *       1.  Profile
 *       2A. Accounts
 *       2B. Categories
 *       2C. Transactions
 *       2D. Budgets
 *       3.  Customers & Invoices (A/R)
 *       4.  Vendors & Bills     (A/P)
 *       5.  Account & Expense Snapshots
 *       6.  Financial Knowledge‑Base glossary
 * 4. The **entry‑point** (`seedAll`) orchestrates these phases sequentially
 *    and logs progress so we can spot which step failed in the event of an
 *    error.
 * 5. Any error thrown by a Supabase call bubbles up and causes the process to
 *    exit with a non‑zero code—handy for CI pipelines.
 *
 * Usage:  `node seedAll.js`
 * ============================================================================
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

/** -------------------------------------------------------------------------
 *  CONFIGURATION
 *  -------------------------------------------------------------------------
 */

/**
 * Admin‑level Supabase client.  Uses the **service‑role** key so this script
 * can read and write any table regardless of Row Level Security (RLS).
 */
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Identifier for the demo user that owns every row seeded by this script.
 * A deterministic UUID makes it easy to join across tables when writing
 * client code or eg. PostgREST filters.
 */
const DUMMY_USER =
    process.env.DUMMY_USER_ID || '00000000-0000-0000-0000-000000000001';

/** -------------------------------------------------------------------------
 *  ENTRY POINT
 *  -------------------------------------------------------------------------
 */

/**
 * Orchestrates all individual seed tasks in a sensible order.  Each task is
 * awaited so tables that rely on foreign keys are populated only after their
 * dependencies exist.  A simple console log trail shows progress.
 */
async function seedAll() {
    try {
        console.log('🔰 Starting seed process...');
        await upsertProfile();

        // Phase 2: Chart of accounts and categories
        const accountMap = await seedAccounts();
        const categoryMap = await seedCategories();

        // Phase 2 continued: operational data
        await seedTransactions(accountMap, categoryMap);
        await seedBudgets(categoryMap);

        // Accounts Receivable
        const custId = await seedCustomers();
        await seedInvoices(custId);

        // Accounts Payable
        const vendId = await seedVendors();
        await seedBills(vendId);

        // Snapshots & analytics
        await seedSnapshots(accountMap);

        // Glossary definitions
        await seedFinancialKB();

        console.log('🎉 All data seeded successfully!');
    } catch (err) {
        console.error('❌ Seed failed:', err);
        process.exit(1);
    }
}

/** -------------------------------------------------------------------------
 * 1) PROFILE
 * --------------------------------------------------------------------------
 */

/**
 * Inserts (or updates) a single demo user profile.  Upsert semantics make the
 * operation idempotent—running the script twice will not create duplicates.
 *
 * @throws {Error}  bubbles up on any Supabase error so `seedAll` can abort.
 */
async function upsertProfile() {
    console.log('⏳ Seeding profiles...');
    const { error } = await supabaseAdmin.from('profiles').upsert({
        id: DUMMY_USER,
        name: 'Felipe Melendez',
        email: 'felipe@example.com',
    });
    if (error) throw error;
    console.log('✅ profiles');
}

/** -------------------------------------------------------------------------
 * 2A) ACCOUNTS
 * --------------------------------------------------------------------------
 */

/**
 * Seeds a minimal **Chart of Accounts** and returns a map of
 * `{ name → account_id }` so that subsequent seeding steps can create
 * foreign‑key references without additional queries.
 *
 * @returns {Promise<Record<string,string>>} name → id lookup object
 * @throws  Propagates Supabase errors
 */
async function seedAccounts() {
    console.log('⏳ Seeding accounts...');
    const accounts = [
        { name: 'Main Checking', type: 'bank', currency: 'USD' },
        { name: 'Credit Card', type: 'liability', currency: 'USD' },
        { name: 'Inventory Account', type: 'asset', currency: 'USD' },
        { name: 'Equipment', type: 'asset', currency: 'USD' },
        { name: 'Owner Equity', type: 'liability', currency: 'USD' },
    ];

    const { data, error } = await supabaseAdmin
        .from('accounts')
        .insert(accounts.map((a) => ({ user_id: DUMMY_USER, ...a })))
        .select('id,name');

    if (error) throw error;
    console.log('✅ accounts');

    return Object.fromEntries(data.map((a) => [a.name, a.id]));
}

/** -------------------------------------------------------------------------
 * 2B) CATEGORIES
 * --------------------------------------------------------------------------
 */

/**
 * Creates the account **Categories** used to tag transactions and budgets.
 * A lookup map similar to `seedAccounts` is returned for convenience.
 *
 * @returns {Promise<Record<string,string>>} name → id lookup object
 */
async function seedCategories() {
    console.log('⏳ Seeding categories...');
    const defs = [
        // original
        { name: 'Sales', type: 'income' },
        { name: 'COGS', type: 'cogs' },
        { name: 'Rent', type: 'expense' },
        { name: 'Marketing', type: 'expense' },
        { name: 'Payroll', type: 'expense' },
        { name: 'Utilities', type: 'expense' },

        // extended
        { name: 'Inventory', type: 'asset' },
        { name: 'Equipment', type: 'asset' },
        { name: 'Depreciation', type: 'expense' },
        { name: 'Owner Equity', type: 'liability' },
    ];

    const { data, error } = await supabaseAdmin
        .from('categories')
        .insert(
            defs.map((d) => ({
                user_id: DUMMY_USER,
                ...d,
                parent_id: null,
            }))
        )
        .select('id,name');

    if (error) throw error;
    console.log('✅ categories');

    return Object.fromEntries(data.map((c) => [c.name, c.id]));
}

/** -------------------------------------------------------------------------
 * 2C) TRANSACTIONS
 * --------------------------------------------------------------------------
 */

/**
 * Populates the **transactions** table with a mix of owner contributions,
 * inventory & equipment purchases, depreciation, credit‑card usage, and
 * everyday revenue/expense entries.  Double‑entry rules are respected by
 * inserting complementary rows for each cash‑flow event.
 *
 * @param {Record<string,string>} accounts  lookup from name → account_id
 * @param {Record<string,string>} cats      lookup from name → category_id
 */
async function seedTransactions(accounts, cats) {
    console.log('⏳ Seeding transactions...');
    const txns = [];

    // — Owner capital injection (cash & equity)
    txns.push({
        user_id: DUMMY_USER,
        account_id: accounts['Main Checking'],
        category_id: cats['Owner Equity'],
        date: '2025-01-01',
        amount: 20000,
        description: 'Owner capital injection (cash)',
        metadata: { source: 'seed' },
    });
    txns.push({
        user_id: DUMMY_USER,
        account_id: accounts['Owner Equity'],
        category_id: cats['Owner Equity'],
        date: '2025-01-01',
        amount: 20000,
        description: 'Owner capital injection (equity)',
        metadata: { source: 'seed' },
    });

    // — Inventory purchase (asset & cash)
    txns.push({
        user_id: DUMMY_USER,
        account_id: accounts['Inventory Account'],
        category_id: cats['Inventory'],
        date: '2025-01-02',
        amount: 3000,
        description: 'Purchased inventory (asset)',
        metadata: { source: 'seed' },
    });
    txns.push({
        user_id: DUMMY_USER,
        account_id: accounts['Main Checking'],
        category_id: cats['Inventory'],
        date: '2025-01-02',
        amount: -3000,
        description: 'Paid for inventory',
        metadata: { source: 'seed' },
    });

    // — Equipment purchase (asset & cash)
    txns.push({
        user_id: DUMMY_USER,
        account_id: accounts['Equipment'],
        category_id: cats['Equipment'],
        date: '2025-01-03',
        amount: 5000,
        description: 'Purchased equipment (asset)',
        metadata: { source: 'seed' },
    });
    txns.push({
        user_id: DUMMY_USER,
        account_id: accounts['Main Checking'],
        category_id: cats['Equipment'],
        date: '2025-01-03',
        amount: -5000,
        description: 'Paid for equipment',
        metadata: { source: 'seed' },
    });

    // — Depreciation expense (monthly)
    ['2025-01-31', '2025-02-28', '2025-03-31'].forEach((d) => {
        txns.push({
            user_id: DUMMY_USER,
            account_id: accounts['Main Checking'],
            category_id: cats['Depreciation'],
            date: d,
            amount: -500,
            description: 'Depreciation expense',
            metadata: { source: 'seed' },
        });
    });

    // — One credit‑card purchase (liability)
    txns.push({
        user_id: DUMMY_USER,
        account_id: accounts['Credit Card'],
        category_id: cats['Utilities'],
        date: '2025-03-10',
        amount: -800,
        description: 'Office supplies (CC)',
        metadata: { source: 'seed' },
    });

    // — Original revenue & expense entries
    const raw = [
        // Jan
        ['2025-01-05', 5000, 'Website subscription', 'Sales'],
        ['2025-01-10', -1200, 'Hosting fees', 'COGS'],
        ['2025-01-15', -2000, 'Office rent (Jan)', 'Rent'],
        ['2025-01-20', 2000, 'Consulting side-project', 'Sales'],
        ['2025-01-31', -1500, 'Employee payroll (Jan)', 'Payroll'],
        // Feb
        ['2025-02-05', 4500, 'Consulting revenue', 'Sales'],
        ['2025-02-14', -800, 'Google Ads', 'Marketing'],
        ['2025-02-15', -2000, 'Office rent (Feb)', 'Rent'],
        ['2025-02-18', 1000, 'One-off support contract', 'Sales'],
        ['2025-02-28', -1600, 'Employee payroll (Feb)', 'Payroll'],
        // Mar
        ['2025-03-02', 6000, 'Product sales', 'Sales'],
        ['2025-03-10', -1500, 'Manufacturing COGS', 'COGS'],
        ['2025-03-15', -2000, 'Office rent (Mar)', 'Rent'],
        ['2025-03-22', 1200, 'Affiliate revenue', 'Sales'],
        ['2025-03-31', -1700, 'Employee payroll (Mar)', 'Payroll'],
    ];
    raw.forEach(([date, amt, desc, cat]) => {
        txns.push({
            user_id: DUMMY_USER,
            account_id: accounts['Main Checking'],
            category_id: cats[cat],
            date,
            amount: amt,
            description: desc,
            metadata: {
                source: 'seed',
                ...(cat === 'Sales' && {
                    unit_price: 100,
                    variable_cost_per_unit: 50,
                }),
            },
        });
    });

    const { error } = await supabaseAdmin.from('transactions').insert(txns);

    if (error) throw error;
    console.log('✅ transactions');
}

/** -------------------------------------------------------------------------
 * 2D) BUDGETS
 * --------------------------------------------------------------------------
 */

/**
 * Seeds a recurring **Marketing** budget for Q1‑2025 so variance analyses
 * have something to chew on.
 *
 * @param {Record<string,string>} cats  lookup from name → category_id
 */
async function seedBudgets(cats) {
    console.log('⏳ Seeding budgets...');
    const months = [
        { start: '2025-01-01', end: '2025-01-31' },
        { start: '2025-02-01', end: '2025-02-28' },
        { start: '2025-03-01', end: '2025-03-31' },
    ];
    const buds = months.map(({ start, end }) => ({
        user_id: DUMMY_USER,
        category_id: cats['Marketing'],
        period_start: start,
        period_end: end,
        amount: 1000,
    }));
    const { error } = await supabaseAdmin.from('budgets').insert(buds);
    if (error) throw error;
    console.log('✅ budgets');
}

/** -------------------------------------------------------------------------
 * 3) CUSTOMERS & INVOICES (Accounts Receivable)
 * --------------------------------------------------------------------------
 */

/**
 * Inserts a single demo **Customer** and returns its primary key so invoices
 * can reference it.
 *
 * @returns {Promise<string>}  customer_id
 */
async function seedCustomers() {
    console.log('⏳ Seeding customers...');
    const { data, error } = await supabaseAdmin
        .from('customers')
        .insert({
            user_id: DUMMY_USER,
            name: 'Acme Corp',
            contact: { email: 'billing@acmecorp.com' },
        })
        .select('id')
        .single();
    if (error) throw error;
    console.log('✅ customers');
    return data.id;
}

/**
 * Creates both **paid** and **unpaid** invoices for the supplied customer so
 * the chatbot can answer questions about cash‑flow and outstanding A/R.
 *
 * @param {string} custId  foreign‑key to `customers.id`
 */
async function seedInvoices(custId) {
    console.log('⏳ Seeding invoices...');
    // paid
    await supabaseAdmin.from('invoices').insert({
        user_id: DUMMY_USER,
        customer_id: custId,
        date: '2025-02-05',
        due_date: '2025-02-20',
        total_amount: 4500,
        status: 'paid',
        metadata: { seed: true },
    });
    // unpaid
    const { error } = await supabaseAdmin.from('invoices').insert({
        user_id: DUMMY_USER,
        customer_id: custId,
        date: '2025-03-10',
        due_date: '2025-03-25',
        total_amount: 2000,
        status: 'sent',
        metadata: { seed: true },
    });
    if (error) throw error;
    console.log('✅ invoices');
}

/** -------------------------------------------------------------------------
 * 4) VENDORS & BILLS (Accounts Payable)
 * --------------------------------------------------------------------------
 */

/**
 * Inserts a single **Vendor** record.
 *
 * @returns {Promise<string>}  vendor_id
 */
async function seedVendors() {
    console.log('⏳ Seeding vendors...');
    const { data, error } = await supabaseAdmin
        .from('vendors')
        .insert({
            user_id: DUMMY_USER,
            name: 'OfficeRentCo',
            contact: { email: 'rent@officerent.com' },
        })
        .select('id')
        .single();
    if (error) throw error;
    console.log('✅ vendors');
    return data.id;
}

/**
 * Generates both **paid** and **unpaid** bills for the vendor inserted in
 * `seedVendors`.
 *
 * @param {string} vendId  foreign‑key to `vendors.id`
 */
async function seedBills(vendId) {
    console.log('⏳ Seeding bills...');
    // paid
    await supabaseAdmin.from('bills').insert({
        user_id: DUMMY_USER,
        vendor_id: vendId,
        date: '2025-03-01',
        due_date: '2025-03-15',
        total_amount: 2000,
        status: 'paid',
        metadata: { seed: true },
    });
    // unpaid
    const { error } = await supabaseAdmin.from('bills').insert({
        user_id: DUMMY_USER,
        vendor_id: vendId,
        date: '2025-02-20',
        due_date: '2025-03-05',
        total_amount: 1500,
        status: 'sent',
        metadata: { seed: true },
    });
    if (error) throw error;
    console.log('✅ bills');
}

/** -------------------------------------------------------------------------
 * 5) SNAPSHOTS
 * --------------------------------------------------------------------------
 */

/**
 * Inserts month‑end **account balances** and **expense snapshots** so that KPI
 * calculations which rely on historical balances have something to work with.
 *
 * @param {Record<string,string>} accounts  lookup from name → account_id
 */
async function seedSnapshots(accounts) {
    console.log('⏳ Seeding snapshots...');
    const snaps = [
        {
            account_id: accounts['Main Checking'],
            snapshot_date: '2025-03-31',
            balance: 15900, // matches all cash flows + depreciation
        },
        {
            account_id: accounts['Inventory Account'],
            snapshot_date: '2025-03-31',
            balance: 3000,
        },
        {
            account_id: accounts['Equipment'],
            snapshot_date: '2025-03-31',
            balance: 5000,
        },
        {
            account_id: accounts['Credit Card'],
            snapshot_date: '2025-03-31',
            balance: -800,
        },
        {
            account_id: accounts['Owner Equity'],
            snapshot_date: '2025-03-31',
            balance: 20000,
        },
    ].map((s) => ({ user_id: DUMMY_USER, ...s }));

    const { error } = await supabaseAdmin
        .from('account_snapshots')
        .insert(snaps);
    if (error) throw error;

    // Monthly expense snapshots (simplified)
    const mErr = await supabaseAdmin.from('monthly_expense_snapshots').insert([
        {
            user_id: DUMMY_USER,
            period_start: '2025-01-01',
            period_end: '2025-01-31',
            total_expense: 1200 + 2000 + 1500 + 500,
        },
        {
            user_id: DUMMY_USER,
            period_start: '2025-02-01',
            period_end: '2025-02-28',
            total_expense: 800 + 2000 + 1600 + 500,
        },
        {
            user_id: DUMMY_USER,
            period_start: '2025-03-01',
            period_end: '2025-03-31',
            total_expense: 1500 + 2000 + 1700 + 500 + 800,
        },
    ]);
    if (mErr.error) throw mErr.error;

    console.log('✅ snapshots');
}

/** -------------------------------------------------------------------------
 * 6) FINANCIAL KNOWLEDGE BASE
 * --------------------------------------------------------------------------
 */

/**
 * Upserts a glossary of common finance KPIs so that the chatbot can provide
 * textbook definitions when queried.  `upsert` with `onConflict: ['title']`
 * guarantees idempotency.
 */
async function seedFinancialKB() {
    console.log('⏳ Seeding financial knowledge base...');
    const definitions = [
        {
            title: 'Runway',
            content:
                'Runway in months = Current Cash Balance ÷ Monthly Burn Rate.',
        },
        {
            title: 'Burn Rate',
            content:
                'Average monthly cash outflow = Total expenses in period ÷ Number of months.',
        },
        {
            title: 'Gross Profit Margin',
            content:
                'Gross Profit Margin % = (Revenue − COGS) ÷ Revenue × 100.',
        },
        {
            title: 'Net Profit Margin',
            content: 'Net Profit Margin % = Net Income ÷ Revenue × 100.',
        },
        {
            title: 'Current Ratio',
            content: 'Current Ratio = Current Assets ÷ Current Liabilities.',
        },
        {
            title: 'Quick Ratio',
            content:
                'Quick Ratio = (Current Assets − Inventory) ÷ Current Liabilities.',
        },
        {
            title: 'Working Capital',
            content: 'Working Capital = Current Assets − Current Liabilities.',
        },
        {
            title: 'Debt-to-Equity Ratio',
            content:
                'Debt-to-Equity = Total Liabilities ÷ Shareholders’ Equity.',
        },
        {
            title: 'Inventory Turnover',
            content: 'Inventory Turnover = COGS ÷ Average Inventory.',
        },
        {
            title: 'Operating Margin',
            content: 'Operating Margin % = Operating Income ÷ Revenue × 100.',
        },
        {
            title: 'Return on Equity (ROE)',
            content: 'ROE % = Net Income ÷ Shareholders’ Equity × 100.',
        },
        {
            title: 'Break-Even Point (Units)',
            content:
                'Break-Even Units = Fixed Costs ÷ (Price − Variable Cost per Unit).',
        },
        {
            title: 'Return on Investment (ROI)',
            content:
                'ROI % = (Gain from Investment − Cost of Investment) ÷ Cost of Investment × 100.',
        },
        {
            title: 'EBITDA',
            content:
                'EBITDA = Earnings before Interest, Taxes, Depreciation, and Amortization.',
        },
        {
            title: 'Days Sales Outstanding (DSO)',
            content:
                'DSO = (Accounts Receivable ÷ Total Credit Sales) × Number of Days.',
        },
        {
            title: 'Days Payable Outstanding (DPO)',
            content: 'DPO = (Accounts Payable ÷ COGS) × Number of Days.',
        },
        {
            title: 'Cash Conversion Cycle',
            content: 'CCC = DSO + Days Inventory Outstanding − DPO.',
        },
        {
            title: 'Budget Variance',
            content:
                'Variance = Actual − Budgeted; % Variance = Variance ÷ Budgeted × 100.',
        },
        {
            title: 'Accrual vs Cash Accounting',
            content:
                'Accrual: revenue/expense when earned/incurred; Cash: when cash changes hands.',
        },
    ];

    // Deduplicate by title just in case
    const uniqueDefs = Array.from(
        new Map(definitions.map((d) => [d.title, d])).values()
    );

    const { error } = await supabaseAdmin
        .from('financial_kb')
        .upsert(uniqueDefs, { onConflict: ['title'] });

    if (error) throw error;
    console.log('✅ financial_kb');
}

/** -------------------------------------------------------------------------
 * RUN THE SCRIPT
 * --------------------------------------------------------------------------
 */
seedAll();
