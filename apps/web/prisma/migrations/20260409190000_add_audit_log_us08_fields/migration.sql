-- AlterTable: add optional columns to audit_logs for US-08 workflow creation tracking
ALTER TABLE "audit_logs" ADD COLUMN "description" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "metadata" JSONB;
