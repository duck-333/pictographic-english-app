-- A zero-object result does not prove complete metadata visibility.
-- Production execution remains STOP until the audit account's INFORMATION_SCHEMA visibility
-- has been independently approved for this exact query contract.
START TRANSACTION READ ONLY;

WITH
preflight_constants AS (
  SELECT
    'baxiaota' AS target_schema,
    '^book_benefit_' AS prefix_pattern,
    '(^|[^a-z0-9_])(book_benefit_campaigns|book_benefit_issuances|book_benefit_codes|book_benefit_redemptions|book_benefit_audit_events|book_benefit_applications)([^a-z0-9_]|$)' AS related_pattern
),
preflight_metrics AS (
  SELECT
    REGEXP_LIKE(VERSION(), '^8\\.0\\.46([-.+]|$)', 'c') AS server_version_compatible,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.SCHEMATA AS s
      WHERE s.SCHEMA_NAME = c.target_schema
    ) AS schema_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TABLES AS t
      WHERE t.TABLE_SCHEMA = c.target_schema
        AND REGEXP_LIKE(t.TABLE_NAME, c.prefix_pattern, 'c')
    ) AS prefix_table_view_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TABLES AS t
      WHERE t.TABLE_SCHEMA = c.target_schema
        AND t.TABLE_NAME IN (
          'book_benefit_campaigns',
          'book_benefit_issuances',
          'book_benefit_codes',
          'book_benefit_redemptions',
          'book_benefit_audit_events',
          'book_benefit_applications'
        )
    ) AS target_legacy_table_view_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.COLUMNS AS col
      WHERE col.TABLE_SCHEMA = c.target_schema
        AND col.TABLE_NAME = 'user_phone_bindings'
        AND col.COLUMN_NAME IN (
          'campaign_phone_identity_hash',
          'campaign_phone_hash_version'
        )
    ) AS phone_column_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.STATISTICS AS st
      WHERE st.TABLE_SCHEMA = c.target_schema
        AND st.TABLE_NAME = 'user_phone_bindings'
        AND st.INDEX_NAME = 'idx_user_phone_bindings_campaign_identity'
    ) AS phone_index_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.VIEWS AS v
      WHERE v.TABLE_SCHEMA = c.target_schema
        AND (
          REGEXP_LIKE(v.TABLE_NAME, c.prefix_pattern, 'c')
          OR REGEXP_LIKE(COALESCE(v.VIEW_DEFINITION, ''), c.related_pattern, 'i')
        )
    ) AS related_view_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TRIGGERS AS tr
      WHERE tr.TRIGGER_SCHEMA = c.target_schema
        AND (
          REGEXP_LIKE(tr.TRIGGER_NAME, c.prefix_pattern, 'c')
          OR REGEXP_LIKE(tr.EVENT_OBJECT_TABLE, c.related_pattern, 'i')
          OR REGEXP_LIKE(COALESCE(tr.ACTION_STATEMENT, ''), c.related_pattern, 'i')
        )
    ) AS related_trigger_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.ROUTINES AS r
      WHERE r.ROUTINE_SCHEMA = c.target_schema
        AND (
          REGEXP_LIKE(r.ROUTINE_NAME, c.prefix_pattern, 'c')
          OR REGEXP_LIKE(COALESCE(r.ROUTINE_DEFINITION, ''), c.related_pattern, 'i')
        )
    ) AS related_routine_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.EVENTS AS e
      WHERE e.EVENT_SCHEMA = c.target_schema
        AND (
          REGEXP_LIKE(e.EVENT_NAME, c.prefix_pattern, 'c')
          OR REGEXP_LIKE(COALESCE(e.EVENT_DEFINITION, ''), c.related_pattern, 'i')
        )
    ) AS related_event_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.VIEWS AS v
      WHERE v.TABLE_SCHEMA = c.target_schema
        AND v.VIEW_DEFINITION IS NULL
    ) AS hidden_view_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TRIGGERS AS tr
      WHERE tr.TRIGGER_SCHEMA = c.target_schema
        AND tr.ACTION_STATEMENT IS NULL
    ) AS hidden_trigger_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.ROUTINES AS r
      WHERE r.ROUTINE_SCHEMA = c.target_schema
        AND r.ROUTINE_DEFINITION IS NULL
    ) AS hidden_routine_count,
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.EVENTS AS e
      WHERE e.EVENT_SCHEMA = c.target_schema
        AND e.EVENT_DEFINITION IS NULL
    ) AS hidden_event_count
  FROM preflight_constants AS c
),
preflight_classification AS (
  SELECT
    m.*,
    CASE
      WHEN m.server_version_compatible <> 1
        OR m.schema_count <> 1
        OR m.hidden_view_count <> 0
        OR m.hidden_trigger_count <> 0
        OR m.hidden_routine_count <> 0
        OR m.hidden_event_count <> 0
        THEN 'UNKNOWN_STOP'
      WHEN m.prefix_table_view_count <> 0
        OR m.target_legacy_table_view_count <> 0
        OR m.phone_column_count <> 0
        OR m.phone_index_count <> 0
        OR m.related_view_count <> 0
        OR m.related_trigger_count <> 0
        OR m.related_routine_count <> 0
        OR m.related_event_count <> 0
        THEN 'NON_PRISTINE_REVIEW_REQUIRED'
      ELSE 'PRISTINE_CANDIDATE'
    END AS classification
  FROM preflight_metrics AS m
)
SELECT
  1 AS query_protocol_version,
  server_version_compatible,
  schema_count,
  prefix_table_view_count,
  target_legacy_table_view_count,
  phone_column_count,
  phone_index_count,
  related_view_count,
  related_trigger_count,
  related_routine_count,
  related_event_count,
  hidden_view_count,
  hidden_trigger_count,
  hidden_routine_count,
  hidden_event_count,
  classification
FROM preflight_classification;

COMMIT;

SELECT 'BOOK_BENEFIT_PRODUCTION_PREFLIGHT_COMPLETE' AS completion_marker;
