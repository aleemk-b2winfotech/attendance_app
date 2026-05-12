ALTER TABLE "users" ADD COLUMN "role" "Role";

UPDATE "users"
SET "role" = CASE
  WHEN 'ADMIN'::"Role" = ANY("roles") THEN 'ADMIN'::"Role"
  WHEN 'MANAGER'::"Role" = ANY("roles") THEN 'MANAGER'::"Role"
  ELSE NULL
END;

ALTER TABLE "users" DROP COLUMN "roles";
