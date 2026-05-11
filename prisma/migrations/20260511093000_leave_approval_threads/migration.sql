-- CreateEnum
CREATE TYPE "LeaveThreadMessageType" AS ENUM (
    'REQUEST',
    'COMMENT',
    'PROPOSAL',
    'ACCEPTANCE',
    'DIRECT_APPROVAL',
    'REJECTION',
    'CANCELLATION'
);

-- AlterTable
ALTER TABLE "leave_requests"
ADD COLUMN "approved_start_date" DATE,
ADD COLUMN "approved_end_date" DATE,
ADD COLUMN "approved_working_day_count" INTEGER;

-- CreateTable
CREATE TABLE "leave_thread_messages" (
    "id" UUID NOT NULL,
    "leave_request_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "message_type" "LeaveThreadMessageType" NOT NULL,
    "message" TEXT,
    "proposed_start_date" DATE,
    "proposed_end_date" DATE,
    "proposed_working_day_count" INTEGER,
    "accepted_thread_message_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_thread_messages_pkey" PRIMARY KEY ("id")
);

-- Backfill approved final dates for already-approved leave requests.
UPDATE "leave_requests"
SET
    "approved_start_date" = "start_date",
    "approved_end_date" = "end_date",
    "approved_working_day_count" = "working_day_count"
WHERE "status" = 'APPROVED';

-- Backfill the immutable original request as the first thread entry.
INSERT INTO "leave_thread_messages" (
    "id",
    "leave_request_id",
    "actor_user_id",
    "message_type",
    "message",
    "proposed_start_date",
    "proposed_end_date",
    "proposed_working_day_count",
    "created_at"
)
SELECT
    md5('leave-thread-request-' || "id"::text)::uuid,
    "id",
    "user_id",
    'REQUEST'::"LeaveThreadMessageType",
    "reason",
    "start_date",
    "end_date",
    "working_day_count",
    "created_at"
FROM "leave_requests";

-- Backfill terminal history for existing approved/rejected/cancelled requests.
INSERT INTO "leave_thread_messages" (
    "id",
    "leave_request_id",
    "actor_user_id",
    "message_type",
    "message",
    "proposed_start_date",
    "proposed_end_date",
    "proposed_working_day_count",
    "created_at"
)
SELECT
    md5('leave-thread-direct-approval-' || "id"::text)::uuid,
    "id",
    COALESCE("action_by_user_id", "user_id"),
    'DIRECT_APPROVAL'::"LeaveThreadMessageType",
    COALESCE("action_note", 'Direct approval'),
    "start_date",
    "end_date",
    "working_day_count",
    COALESCE("action_at", "updated_at", "created_at")
FROM "leave_requests"
WHERE "status" = 'APPROVED';

INSERT INTO "leave_thread_messages" (
    "id",
    "leave_request_id",
    "actor_user_id",
    "message_type",
    "message",
    "created_at"
)
SELECT
    md5('leave-thread-rejection-' || "id"::text)::uuid,
    "id",
    COALESCE("action_by_user_id", "user_id"),
    'REJECTION'::"LeaveThreadMessageType",
    COALESCE("action_note", 'Rejected'),
    COALESCE("action_at", "updated_at", "created_at")
FROM "leave_requests"
WHERE "status" = 'REJECTED';

INSERT INTO "leave_thread_messages" (
    "id",
    "leave_request_id",
    "actor_user_id",
    "message_type",
    "message",
    "created_at"
)
SELECT
    md5('leave-thread-cancellation-' || "id"::text)::uuid,
    "id",
    COALESCE("action_by_user_id", "user_id"),
    'CANCELLATION'::"LeaveThreadMessageType",
    COALESCE("action_note", 'Cancelled'),
    COALESCE("action_at", "updated_at", "created_at")
FROM "leave_requests"
WHERE "status" = 'CANCELLED';

-- CreateIndex
CREATE INDEX "leave_thread_messages_leave_request_id_created_at_idx" ON "leave_thread_messages"("leave_request_id", "created_at");

-- CreateIndex
CREATE INDEX "leave_thread_messages_actor_user_id_idx" ON "leave_thread_messages"("actor_user_id");

-- CreateIndex
CREATE INDEX "leave_thread_messages_accepted_thread_message_id_idx" ON "leave_thread_messages"("accepted_thread_message_id");

-- AddForeignKey
ALTER TABLE "leave_thread_messages" ADD CONSTRAINT "leave_thread_messages_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_thread_messages" ADD CONSTRAINT "leave_thread_messages_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_thread_messages" ADD CONSTRAINT "leave_thread_messages_accepted_thread_message_id_fkey" FOREIGN KEY ("accepted_thread_message_id") REFERENCES "leave_thread_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
