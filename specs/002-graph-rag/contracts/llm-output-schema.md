# LLM Output Schema Contracts

This document defines the interface schemas for LLM inputs and outputs across the GraphRAG pipeline.

## 1. Triplet Extraction Schema

To achieve high speeds and low token overhead, the `GraphRAGExtractor` uses a custom delimiter-separated string format.

### Prompt Directive
Extract entities and relationships from the email text. Format the output as a list of raw tuples separated by `##`. Do not include markdown wraps or explanations.

### Custom Triplet String Format
- **Entity**: `("entity"|<name>|<type>|<description>)`
- **Relationship**: `("relationship"|<source>|<target>|<relation_type>|<description>|<strength>)`

### Example Raw LLM Output
```text
("entity"|ALICE SMITH|CONTACT|API platforms lead engineer)##("entity"|PROJECT APOLLO|PROJECT|API design overhaul initiative)##("relationship"|ALICE SMITH|PROJECT APOLLO|ASSIGNED_TO|Alice is assigned as lead developer on Project Apollo|10)
```

---

## 2. Community Report Schema

The `GraphRAGStore` invokes `llama-3.1-8b-instant` to generate a structured cluster report. The LLM must output a valid JSON object matching this schema.

### JSON Schema Specification
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CommunityReport",
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "Descriptive title summarizing the cluster (e.g. 'Project Apollo API Overhaul')"
    },
    "summary": {
      "type": "string",
      "description": "High-level summary of the active discussions, threads, and tasks in the cluster."
    },
    "rating": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 10.0,
      "description": "Priority/urgency score representing active blockers or outages."
    },
    "rating_explanation": {
      "type": "string",
      "description": "One-sentence rationale for the urgency score."
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "summary": {
            "type": "string",
            "description": "Short heading summarizing the finding."
          },
          "explanation": {
            "type": "string",
            "description": "Detailed explanation of the finding, citing entities and relationships [Data: Entities (ids); Relationships (ids)]."
          }
        },
        "required": ["summary", "explanation"]
      }
    }
  },
  "required": ["title", "summary", "rating", "rating_explanation", "findings"]
}
```
