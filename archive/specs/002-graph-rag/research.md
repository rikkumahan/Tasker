# Research: GraphRAG Algorithms & Entity Resolution

## 1. Community Detection: Louvain vs. Leiden in Deno TypeScript

In Python-based GraphRAG implementations, `networkx` or `graspologic` are typically used to run the Leiden clustering algorithm. Since Deno Edge Functions run on a V8 sandbox without easy access to Python environments, we researched writing a native TypeScript clustering algorithm.

### Leiden vs. Louvain
- **Leiden**: Solves the "bad modularity" issue of Louvain where communities can become internally disconnected.
- **Louvain**: Simpler to write from scratch in TypeScript. It is a greedy optimization method that runs in $O(L \log N)$ time, partitioning nodes into communities to maximize modularity:
  $$Q = \frac{1}{2m} \sum_{i,j} \left[ A_{ij} - \frac{k_i k_j}{2m} \right] \delta(c_i, c_j)$$

### Decision
Implement a native **Louvain clustering algorithm** in Deno. It has two phases:
1. **Modularity Optimization**: Iterate over nodes, moving each node to the community of its neighbor that yields the largest modularity gain, until no further modularity improvement can be achieved.
2. **Community Aggregation**: Build a new coarse-grained graph where nodes represent the communities found in Phase 1, and edges between communities represent the sum of weights between members.
Iterate these two phases until modularity stabilizes. This is lightweight and runs in under 1 second for graphs with <1,000 nodes.

---

## 2. Entity Resolution & Deduplication

In corporate emails, entities are written in many variations (e.g., "John Doe" vs "John", "Acme Corp" vs "Acme Corporation"). Resolving these is critical to prevent graph fragmentation.

### Resolution Pipeline
1. **Case-insensitive Normalization**: Senders, recipients, and organizations are converted to uppercase (e.g. `JOHN DOE`, `ACME CORP`). If an exact normalized name match exists, they are resolved instantly.
2. **Embedding-Based Cosine Similarity**: For new entities, we query the `contacts` or `projects` table using vector similarity search (threshold < 0.15). If the cosine distance is close, they are resolved as duplicates.
3. **Merge Logic**:
   - Merge descriptions by concatenating: `[Source Description] | [Merged Description]`.
   - Update all rows in `graph_edges` pointing to the duplicate node ID to point to the canonical node ID.
   - Delete the duplicate node.

---

## 3. LLM Model Strategy on Groq

For cost-effective and high-speed execution, we employ a multi-model architecture:

| Pipeline Step | Model | Reasoning |
|---|---|---|
| **Triplet Extraction** | `llama-3.3-70b-specdec` | Speculative decoding makes it fast. Strong instruction-following is required to output the custom record-delimiter format (`##`) reliably. |
| **Community Summaries** | `llama-3.1-8b-instant` | High speed and low cost are critical because we run this over every detected community report. |
| **Global Map Step** | `llama-3.1-8b-instant` | Executed in parallel across communities. Low latency is required. |
| **Global Reduce Step** | `llama-3.3-70b-specdec` | Synthesizes and deduplicates multiple partial answers into the final answer. |
