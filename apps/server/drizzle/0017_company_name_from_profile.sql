-- Companies created before onboarding were named after the local part of the account e-mail, and migration 0010
-- read the trade name with `company->>'name'`, which is null when the driver stored the JSON document as a string:
-- it fell back to the e-mail too. The company takes the trade name of the profile; a name the person chose
-- (anything else than the e-mail local part) is left alone.
WITH "trade" AS (
  SELECT "company_id",
    btrim(COALESCE(
      (CASE WHEN jsonb_typeof("company") = 'string' THEN ("company" #>> '{}')::jsonb ELSE "company" END)->>'name',
      ''
    )) AS "name"
  FROM "profiles"
)
UPDATE "companies" SET "name" = "trade"."name"
FROM "trade", "users"
WHERE "trade"."company_id" = "companies"."id"
  AND "users"."id" = "companies"."user_id"
  AND "companies"."name" = split_part("users"."email", '@', 1)
  AND "trade"."name" <> '';
