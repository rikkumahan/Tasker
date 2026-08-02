-- e2e/ISSUES.md ISSUE-3: project descriptions ending in a corrupted fragment like
-- `)\n## ("entity`. Root cause traced to a pre-refactor version of graph.ts's triplet
-- parser (`parseTriplets`, replaced by `parseGraphTriplets` in commit 9c87f6e) which used
-- a single greedy regex across the *whole* raw LLM response instead of splitting on "##"
-- first. Because a tuple's closing ")" followed by whitespace (the model's actual output
-- shape) wasn't treated as a terminator, the regex merged one entity's tuple with the raw
-- text of every tuple that followed it, leaking that text into the description field.
--
-- Confirmed live: every affected row's created_at predates the 2026-07-01 refactor, and no
-- row created after it is affected — the parser bug is already fixed going forward. This
-- migration only repairs the historical rows the old parser already corrupted, since
-- `ingest_graphrag_payload` uses `ON CONFLICT (user_id, name) DO NOTHING` on projects, so a
-- future extraction of the same project name will never overwrite the bad description.
UPDATE projects
SET description = regexp_replace(description, '\)\s*(##\s*)?\(\s*"?entity.*$', '', 'i')
WHERE description ~* '##|\("?entity';
