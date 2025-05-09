export const accounts = [
    {
        id: 'a1',
        user_id: 'u1',
        name: 'Checking Account',
        type: 'bank',
        currency: 'USD',
    },
];

export const categories = [
    { id: 'c1', user_id: 'u1', name: 'Sales', type: 'income', parent_id: null },
    { id: 'c2', user_id: 'u1', name: 'COGS', type: 'cogs', parent_id: null },
    { id: 'c3', user_id: 'u1', name: 'Rent', type: 'expense', parent_id: null },
    {
        id: 'c4',
        user_id: 'u1',
        name: 'Marketing',
        type: 'expense',
        parent_id: null,
    },
];

export const transactions = [
    // January
    {
        id: 't1',
        user_id: 'u1',
        account_id: 'a1',
        category_id: 'c1',
        date: '2025-01-05',
        amount: 5000,
        description: 'Website subscription revenue',
    },
    {
        id: 't2',
        user_id: 'u1',
        account_id: 'a1',
        category_id: 'c2',
        date: '2025-01-10',
        amount: -1200,
        description: 'Hosting fees (COGS)',
    },
    {
        id: 't3',
        user_id: 'u1',
        account_id: 'a1',
        category_id: 'c3',
        date: '2025-01-15',
        amount: -2000,
        description: 'Office rent January',
    },
    // February
    {
        id: 't4',
        user_id: 'u1',
        account_id: 'a1',
        category_id: 'c1',
        date: '2025-02-03',
        amount: 4500,
        description: 'Consulting revenue',
    },
    {
        id: 't5',
        user_id: 'u1',
        account_id: 'a1',
        category_id: 'c4',
        date: '2025-02-14',
        amount: -800,
        description: 'Google Ads February',
    },
    {
        id: 't6',
        user_id: 'u1',
        account_id: 'a1',
        category_id: 'c3',
        date: '2025-02-15',
        amount: -2000,
        description: 'Office rent February',
    },
    // March
    {
        id: 't7',
        user_id: 'u1',
        account_id: 'a1',
        category_id: 'c1',
        date: '2025-03-02',
        amount: 6000,
        description: 'Product sales',
    },
    {
        id: 't8',
        user_id: 'u1',
        account_id: 'a1',
        category_id: 'c2',
        date: '2025-03-10',
        amount: -1500,
        description: 'Manufacturing COGS',
    },
    {
        id: 't9',
        user_id: 'u1',
        account_id: 'a1',
        category_id: 'c3',
        date: '2025-03-15',
        amount: -2000,
        description: 'Office rent March',
    },
];

export const budgets = [
    {
        id: 'b1',
        user_id: 'u1',
        category_id: 'c4',
        period_start: '2025-01-01',
        period_end: '2025-01-31',
        amount: 1000,
    },
    {
        id: 'b2',
        user_id: 'u1',
        category_id: 'c4',
        period_start: '2025-02-01',
        period_end: '2025-02-28',
        amount: 1000,
    },
    {
        id: 'b3',
        user_id: 'u1',
        category_id: 'c4',
        period_start: '2025-03-01',
        period_end: '2025-03-31',
        amount: 1000,
    },
];

export const customers = [
    {
        id: 'cust1',
        user_id: 'u1',
        name: 'Felipe',
        contact: { email: 'felipe@example.com' },
    },
];

export const invoices = [
    {
        id: 'inv1',
        user_id: 'u1',
        customer_id: 'cust1',
        date: '2025-02-05',
        due_date: '2025-02-20',
        total_amount: 4500,
        status: 'paid',
    },
];

export const vendors = [
    {
        id: 'v1',
        user_id: 'u1',
        name: 'OfficeRentCo',
        contact: { email: 'billing@officerent.com' },
    },
];

export const bills = [
    {
        id: 'bill1',
        user_id: 'u1',
        vendor_id: 'v1',
        date: '2025-03-01',
        due_date: '2025-03-15',
        total_amount: 2000,
        status: 'paid',
    },
];
