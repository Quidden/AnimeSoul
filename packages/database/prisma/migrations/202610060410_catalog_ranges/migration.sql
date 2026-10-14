-- AlterTable
ALTER TABLE "CatalogImportJob" ADD COLUMN     "strategy" TEXT NOT NULL DEFAULT 'offset',
ADD COLUMN     "upperBound" INTEGER;
