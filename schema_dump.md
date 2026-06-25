## Database Schema

### Table: user_settings
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| categories | array |  |
| created_at | string |  |
| user_profile | string |  |
| gmail_token | jsonb |  |
| user_id | string |  |
| last_synced_at | string |  |
| last_sync_triggered_at | string |  |
| last_sync_error | string |  |
| secrets | jsonb |  |
| gmail_email | string |  |
| recent_actions | array |  |
| sync_status | string |  |
| sync_page_token | string |  |
| sync_in_progress | boolean |  |
| sync_lock_at | string |  |
| sync_flags | jsonb |  |
| onboarding_status | string |  |
| onboarding_progress | jsonb |  |

### Table: contacts
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| email | string |  |
| name | string |  |
| organization | string |  |
| bio_summary | string |  |
| embedding | string |  |
| created_at | string |  |
| user_id | string |  |

### Table: threads
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| gmail_thread_id | string |  |
| subject | string |  |
| semantic_summary | string |  |
| project_id | string | Note:
This is a Foreign Key to `projects.id`.<fk table='projects' column='id'/> |
| created_at | string |  |
| user_id | string |  |
| urgency | string |  |
| action_type | string |  |
| ai_summary | string |  |
| is_read | boolean |  |
| action_items | jsonb |  |
| suggested_reply | string |  |

### Table: sync_queue
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| user_id | string |  |
| dedup_id | string |  |
| status | string |  |
| retry_count | integer |  |
| next_retry_at | string |  |
| error_message | string |  |
| created_at | string |  |
| priority | string |  |
| updated_at | string |  |

### Table: debug_logs
| Column | Type | Description |
| --- | --- | --- |
| id | integer | Note:
This is a Primary Key.<pk/> |
| created_at | string |  |
| user_id | string |  |
| event | string |  |
| data | jsonb |  |

### Table: raw_emails
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| user_id | string |  |
| message_id | string |  |
| subject | string |  |
| body | string |  |
| snippet | string |  |
| received_at | string |  |
| status | string |  |
| created_at | string |  |
| sender | string |  |
| thread_id | string |  |

### Table: tasks
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| title | string |  |
| course | string |  |
| deadline | string |  |
| location | string |  |
| summary | string |  |
| source_email_id | string |  |
| status | string |  |
| updated | boolean |  |
| change_note | string |  |
| warnings | array |  |
| created_at | string |  |
| category | string |  |
| starred | boolean |  |
| user_id | string |  |
| end_time | string |  |
| project_id | string | Note:
This is a Foreign Key to `projects.id`.<fk table='projects' column='id'/> |
| assignee_id | string | Note:
This is a Foreign Key to `contacts.id`.<fk table='contacts' column='id'/> |

### Table: graph_edges
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| source_id | string |  |
| target_id | string |  |
| source_type | string |  |
| target_type | string |  |
| relationship_type | string |  |
| description | string |  |
| created_at | string |  |
| user_id | string |  |

### Table: community_reports
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| title | string |  |
| summary | string |  |
| rating | number |  |
| rating_explanation | string |  |
| findings | jsonb |  |
| embedding | string |  |
| created_at | string |  |
| user_id | string |  |

### Table: projects
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| name | string |  |
| description | string |  |
| status | string |  |
| created_at | string |  |
| user_id | string |  |

### Table: community_members
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| community_id | string | Note:
This is a Foreign Key to `community_reports.id`.<fk table='community_reports' column='id'/> |
| node_id | string |  |
| node_type | string |  |
| user_id | string |  |

### Table: emails
| Column | Type | Description |
| --- | --- | --- |
| id | string | Note:
This is a Primary Key.<pk/> |
| message_id | string |  |
| thread_id | string | Note:
This is a Foreign Key to `threads.id`.<fk table='threads' column='id'/> |
| sender_id | string | Note:
This is a Foreign Key to `contacts.id`.<fk table='contacts' column='id'/> |
| subject | string |  |
| body | string |  |
| snippet | string |  |
| received_at | string |  |
| embedding | string |  |
| created_at | string |  |
| user_id | string |  |

