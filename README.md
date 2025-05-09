# 🧠 rag-finance-engine

This project is a Retrieval-Augmented Generation (RAG) engine I built to explore how to make financial data more accessible, auditable, and precise in natural language systems. My goal was to go beyond basic RAG demos and build something that could reliably answer questions like “What’s my burn rate?” or “How much runway do I have?”—using real, structured financial data.

What I learned: treating each row of data as its own _semantic unit_ and embedding it separately creates a far more reliable, debuggable, and scalable system. Below, I explain why that chunked approach matters and the principles I followed in designing the system.

---

## Why Chunking Matters

Indexing each record (or “chunk”) separately instead of mashing the entire dataset into one giant embedding is crucial for reliable, accurate RAG. Here’s what I found:

1. **Precision of Retrieval**

-   Fine-grained hits: By embedding each transaction, snapshot, invoice, etc., it’s possible to retrieve only the relevant rows for a given question. For example, “What was my March burn rate?” returns just the monthly-expense rows for March.
-   Monolithic misses: Embedding all data into one vector forces nearest-neighbor search to retrieve the entire dataset—or none of it. That bloats the prompt and makes answers less precise.

2. **Scalability & Costs**

-   Incremental updates: Per-row embeddings allow re-embedding only changed or new rows, which is fast and efficient.
-   Token limits: Embedding large blobs can hit token caps. Chunking avoids that entirely.

3. **Maintainability & Debuggability**

-   Traceability: Each embedding stores source_table and source_id, making it easy to trace where a retrieved fact came from.
-   Selective pruning: I could drop outdated records or fix just one row without needing to rebuild the entire index.

4. **Relevance Ranking**

-   Ordering by similarity: Since each record is its own embedding, cosine similarity results are meaningful and reflect true relevance.
-   Garbage at both ends: With monolithic embeddings, subtopics blur together—ranking becomes noisy and unreliable.

---

## Why RAG Systems Are Fragile

During testing, I encountered subtle failure modes that made it clear how brittle some RAG setups can be. Here are a few key pitfalls I identified:

1. **Opaque Identifiers**

Rows that rely only on foreign keys or UUIDs (e.g. account_id=3fa85f64...) hide meaning. The model has no way to interpret what that account represents.

2. **Lack of Semantic Anchors**

Embeddings work on meaning. If the serialized row never mentions keywords like "cash", "expense", or "balance", then queries like “burn rate” may fail to retrieve the row—even if the numbers are present.

3. **Precision Requirements vs. Vector Noise**

Financial answers depend on exact values. Embeddings introduce semantic noise, which can cause the model to surface irrelevant text or miss the exact value needed to compute a KPI.

4. **Unpredictable Context Windows**

Prompts only include a limited number of retrieved documents. If the critical row isn’t in the top results, the model can’t access it and will either guess or say “I don’t have that data.”

---

## Best Practices I Followed

To make the system accurate, testable, and extensible, I followed these embedding and indexing practices:

1. **Serialize Into Human-Readable Facts**

Instead of embedding raw data or UUIDs, I converted each row into a clear, readable sentence that captures its meaning. Examples:

Account Balance | account_name="Main Checking" | account_type="cash" | as_of="2025-05-07" | cash_balance=15000

Monthly Expense Snapshot | period="2025-03-01 to 2025-03-31" | total_expense=16500

Formula | title="Runway" | expression="Runway = Current Cash Balance ÷ Monthly Burn Rate"

2. **Avoid UUIDs in Content**

Before serializing, I joined related tables to inline human-readable names and types. This made the embeddings semantically meaningful and easier to retrieve through natural language queries.

3. **Keep Facts Granular**

Each embedding represents just one fact—whether that’s a snapshot, a formula, or a transaction. This made ranking and retrieval more accurate and the context window more efficient.

4. **Use a Consistent Serialization Function**

I implemented a simple function that turns any row into a structured, pipe-separated fact string depending on its table. For example:

-   For account_snapshots:  
    Account Balance | account_name="Main Checking" | account_type="cash" | as_of="..." | cash_balance=...

-   For monthly_expense_snapshots:  
    Monthly Expense Snapshot | period="..." | total_expense=...

-   For financial_kb (formulas):  
    Formula | title="..." | expression="..."

For other tables, the function falls back to a generic serializer that ignores irrelevant fields like metadata or updated_at.

5. **Enforce Upsert Uniqueness**

To support safe re-indexing, I added a unique constraint on (source_table, source_id). This way, re-running the embedding script just updates what’s changed—no duplication.

---

## Outcome

By turning every financial row into a standalone, semantically rich fact and storing those in a vector database, I was able to build a RAG engine that:

-   Retrieves only the relevant facts for any given query
-   Avoids bloating the prompt with unnecessary context
-   Makes it easy to debug, trace, and test retrieval accuracy
-   Handles updates incrementally and efficiently

This project helped me understand how fragile generic RAG systems can be—and how chunked, well-structured embeddings can turn them into something reliable, auditable, and production-worthy.

---
