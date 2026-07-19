# Feature Specification: Context-Aware Corporate Email GraphRAG

**Feature Branch**: `002-graph-rag`

**Created**: 2026-05-24

**Status**: Draft

**Input**: User description: "Implement Supabase/Deno Context-Aware Property Graph and GraphRAG Pipeline with React UI"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Graph-Level Thematic Analytics (Priority: P1)

Users need a way to search across their entire email communication archive to identify general business themes, project statuses, and active disputes. Unlike traditional search, which only finds specific keywords or single messages, this user story allows querying high-level, cross-thread questions (e.g., "What are the active vendor issues?") and receiving a synthesized response.

**Why this priority**: This is the core value proposition of GraphRAG. It solves the limitation of traditional keyword search by reasoning over summarized thematic clusters.

**Independent Test**: Can be tested by asking a global question like "What are the main operational issues discussed across our vendor emails?" and receiving a high-level summary that aggregates points from multiple distinct threads.

**Acceptance Scenarios**:

1. **Given** that the system has ingested emails from "Vendor A" discussing API timeline delays and emails from "Vendor B" discussing billing disputes, **When** the user asks "What are the active vendor issues?", **Then** the system returns a response highlighting both the API timeline delays and the billing disputes.
2. **Given** that there are no active discussions in the email archive regarding a specific topic (e.g., "hiring"), **When** the user asks "What is the status of our hiring pipeline?", **Then** the system replies that no relevant information is available.

---

### User Story 2 - Cross-Entity and Neighborhood Exploration (Priority: P2)

Users need to ask detailed questions about relationships (e.g., "Who is working on Project Apollo and what are their tasks?") and verify the answers using inline citations that link back to the source emails.

**Why this priority**: Users must be able to trust the AI's synthesized answers. Providing citation badges that open the original email threads allows them to manually verify facts.

**Independent Test**: Can be tested by querying for "Who is working on Project Apollo?" and clicking the citation badges in the chat response to open a modal displaying the original email subject, date, and body snippet.

**Acceptance Scenarios**:

1. **Given** an email thread where Alice is assigned to Project Apollo, **When** the user asks "Who is working on Project Apollo?", **Then** the response states that Alice is assigned to it and includes a clickable citation badge for that email thread.
2. **Given** a citation badge in the search response, **When** the user clicks the badge, **Then** a modal opens showing the sender, subject, date, and body snippet of the source email.

---

### User Story 3 - Contacts & Projects Directory (Priority: P3)

Users need a dashboard directory where they can browse resolved contacts (with AI-generated biographies and organization affiliations) and active projects (with statuses and active deliverables) to understand the landscape of their communications without searching.

**Why this priority**: Provides an alternative, structured way to explore the extracted graph entities (contacts, organizations, projects) directly.

**Independent Test**: Browsing the Directory tab lists all contacts and projects with their generated details.

**Acceptance Scenarios**:

1. **Given** several emails from "John Doe" at "Acme Corp", **When** the user views the Contacts Directory, **Then** they see "John Doe" listed under "Acme Corp" with an auto-generated biography summarizing his active threads.
2. **Given** a dynamic project cluster identified by the system, **When** the user views the Projects Directory, **Then** they see the project listed with its status and active deliverables.

---

### Edge Cases

- **Name Variations**: When the system encounters multiple variations of the same name (e.g., "Acme Corp", "Acme Corporation", or "John Doe", "John"), it must resolve them to a single canonical entity to prevent duplicate nodes.
- **Out-of-Scope Queries**: When a user queries a topic completely unrelated to their corporate emails (e.g., "What is the capital of France?"), the query engine must politely state that it only answers questions based on the email context.
- **Empty Graph**: If the email synchronization has not run or has zero messages, the search interface must show a friendly empty state instead of crashing or returning database errors.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST extract entities (contacts, organizations, projects, tasks, email threads, topics) and relationships from incoming email text.
- **FR-002**: The system MUST resolve name variations of the same entity (such as case-insensitive exact name matches and highly similar entities of the same type) to a single canonical node, merging their descriptions and updating relationships.
- **FR-003**: The system MUST group entities and relationships into thematic clusters in the background and generate structured summary reports for each cluster, including an urgency rating and grounding references.
- **FR-004**: The system MUST answer global thematic queries by mapping the questions across relevant cluster summaries and reducing them into a single response.
- **FR-005**: The system MUST answer local queries by retrieving the localized neighborhood subgraph (up to 2 hops) around relevant email nodes and synthesizing a grounded answer.
- **FR-006**: Users MUST be able to query the system via a chat interface that supports toggle search modes (Global vs Local) and renders inline citation badges.
- **FR-007**: The system MUST provide a directory showing all extracted contacts (with dynamic biographies) and projects.

### Key Entities

- **Contact**: Represents a person (sender or recipient). Key attributes: name, email, organization, biography.
- **Project**: Represents a project or work focus area. Key attributes: name, description, status.
- **Email Thread**: Represents a group of related email messages. Key attributes: subject, semantic summary.
- **Task**: Represents an action item, deadline, or meeting. Key attributes: title, status, assignee, project.
- **Graph Edge**: Represents a connection between entities (e.g., SENT_BY, ASSIGNED_TO, PART_OF) with a context description.
- **Community Report**: Represents a cluster of entities and relationships, containing title, summary, findings, and priority rating.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users receive answers to global search queries in under 5 seconds.
- **SC-002**: Inline citation badges open the correct email thread details 100% of the time.
- **SC-003**: The entity resolution process correctly merges naming variations (e.g., "John Doe" vs "John") with a false positive rate of less than 5%.
- **SC-004**: System updates dynamic community reports and directory data within 1 minute after new emails are synced.

## Assumptions

- Senders and recipients are always parsed into CONTACT nodes.
- PII redaction is performed on email contents before graph extraction.
- User email synchronization is handled by an existing Gmail integration.
- The UI is accessed via the existing React web application.
