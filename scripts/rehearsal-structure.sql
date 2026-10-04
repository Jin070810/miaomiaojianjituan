-- Compare logical schema, including PostgreSQL-only constraints and triggers.
-- No table rows, owners, ACLs, sequence values or physical column order.
\set ON_ERROR_STOP on
SET search_path TO public, pg_catalog;
WITH relations AS (
  SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname <> '_prisma_migrations'
), objects AS (
  SELECT 'relation' kind,c.relname::text key,
    jsonb_build_object('kind',c.relkind,'persistence',c.relpersistence,'rls',c.relrowsecurity,
      'forceRls',c.relforcerowsecurity,'options',c.reloptions) definition
  FROM relations c WHERE c.relkind IN ('r','p','v','m','f')
  UNION ALL
  SELECT 'column',c.relname||'.'||a.attname,
    jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
      'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
      'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END)
  FROM relations c JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
  WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint',c.relname||'.'||x.conname,
    jsonb_build_object('definition',pg_get_constraintdef(x.oid),'validated',x.convalidated)
  FROM relations c JOIN pg_constraint x ON x.conrelid=c.oid
  UNION ALL
  SELECT 'index',c.relname||'.'||i.relname,
    jsonb_build_object('definition',pg_get_indexdef(x.indexrelid),'valid',x.indisvalid,'ready',x.indisready)
  FROM relations c JOIN pg_index x ON x.indrelid=c.oid JOIN pg_class i ON i.oid=x.indexrelid
  UNION ALL
  SELECT 'trigger',c.relname||'.'||t.tgname,
    jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
  FROM relations c JOIN pg_trigger t ON t.tgrelid=c.oid WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    to_jsonb(pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')
  UNION ALL
  SELECT 'enum',t.typname,jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
  FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
  WHERE n.nspname='public' GROUP BY t.typname
  UNION ALL
  SELECT 'view',c.relname,to_jsonb(pg_get_viewdef(c.oid)) FROM relations c WHERE c.relkind IN ('v','m')
  UNION ALL
  SELECT 'policy',c.relname||'.'||p.polname,
    jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,'using',pg_get_expr(p.polqual,p.polrelid),
      'check',pg_get_expr(p.polwithcheck,p.polrelid),'roles',p.polroles)
  FROM relations c JOIN pg_policy p ON p.polrelid=c.oid
  UNION ALL
  SELECT 'sequence',c.relname,jsonb_build_object('type',format_type(s.seqtypid,NULL),'start',s.seqstart,
    'increment',s.seqincrement,'max',s.seqmax,'min',s.seqmin,'cache',s.seqcache,'cycle',s.seqcycle)
  FROM relations c JOIN pg_sequence s ON s.seqrelid=c.oid
)
SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'key',key,'definition',definition) ORDER BY kind,key),'[]'::jsonb)
FROM objects;
