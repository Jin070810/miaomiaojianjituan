-- Run only in the disposable, network-isolated rehearsal database. No export.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'miaomiao_rehearsal' OR
     to_regclass('rehearsal_guard.authorized_copy') IS NULL THEN
    RAISE EXCEPTION 'Refusing to sanitize a database without the isolated-copy guard';
  END IF;
END $$;
-- Session IDs are bearer credentials, unlike internal relational IDs.
TRUNCATE "Session";
DO $$
DECLARE c record; replacement text; salt text := md5(random()::text || clock_timestamp()::text);
BEGIN
  FOR c IN SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name <> '_prisma_migrations'
      AND data_type IN ('text','character varying','json','jsonb','ARRAY')
    ORDER BY table_name,ordinal_position
  LOOP
    -- Preserve opaque relational IDs and fixed business vocabulary. Platform
    -- handles/video IDs, URLs, tokens, names, encrypted PII and all free text
    -- are replaced. Their original values never leave this private container.
    IF c.data_type IN ('text','character varying') AND
       (c.column_name='id' OR c.column_name ~ 'Id$' OR
        c.column_name IN ('key','code','status','sourceKind','sourceTable','scoreVersion',
          'drawPolicyVersion','rewardPolicyVersion','promptVersion','presetCode')) AND
       c.column_name NOT IN ('kuaishouId','photoId','sourceId','authorUid','fetchedAuthorUid') THEN
      CONTINUE;
    END IF;
    IF c.data_type IN ('text','character varying') THEN
      replacement := format('CASE WHEN %1$I IS NULL THEN NULL ELSE %2$L || md5(%3$L || %1$I) END',
        c.column_name,'redacted_',salt);
    ELSIF c.data_type='ARRAY' THEN
      replacement := '''{}''';
    ELSE
      replacement := CASE WHEN c.is_nullable='YES' THEN 'NULL' ELSE '''{}''' END;
    END IF;
    EXECUTE format('UPDATE %I.%I SET %I=%s','public',c.table_name,c.column_name,replacement);
  END LOOP;
END $$;
UPDATE "MemberBirthdayProfile" SET "birthDateEnc"=NULL,"pendingBirthDateEnc"=NULL,
  "birthMonth"=NULL,"birthDay"=NULL,"pendingBirthMonth"=NULL,"pendingBirthDay"=NULL;
COMMIT;
