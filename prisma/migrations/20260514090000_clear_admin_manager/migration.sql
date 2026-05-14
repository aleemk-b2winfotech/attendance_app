UPDATE "users"
SET "manager_user_id" = NULL
WHERE "role" = 'ADMIN'::"Role"
  AND "manager_user_id" IS NOT NULL;
