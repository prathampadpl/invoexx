# Implementation Plan - Multi-Bill PDF Separation & Upload Scaling

This plan outlines the architectural enhancements required to support large PDF uploads (up to 50MB) and intelligent AI-driven separation of multi-bill PDF documents into distinct invoice records for human verification.

## Problem Statement & Goal
Currently, INVOEX restricts document uploads to 10MB and assumes each uploaded file represents exactly one invoice. However, enterprise workflows frequently involve scanning multiple distinct bills into a single consolidated PDF document. 
The goal is to:
1. Increase the upload size limit from 10MB to 50MB across the frontend and backend.
2. Upgrade the Gemini 2.5 Flash multimodal prompt and JSON response schema to detect, separate, and extract multiple distinct bills contained within a single file.
3. Enhance the frontend batch processor (`UploadBatch.tsx`) to dynamically fork separate Firestore invoice records for each distinct bill identified by the AI, linking them to the same source PDF for seamless human verification.

---

## User Review Required & Open Questions

> [!IMPORTANT]
> **Firestore Document Forking:** When a single PDF containing 3 bills is uploaded, the system will create 3 separate invoice records in Firestore (e.g. `invoice.pdf (Bill 1, Page 1)`, `invoice.pdf (Bill 2, Pages 2-3)`). All 3 records will share the same `fileUrl` so the verification dashboard (`Review.tsx`) can display the original PDF.

> [!TIP]
> **Gemini Context Window:** Gemini 2.5 Flash supports up to 1M tokens, making it exceptionally well-suited for analyzing 50MB multi-page PDFs containing numerous bills.

---

## Proposed Changes

### Backend API (`server.ts`)

#### [MODIFY] `server.ts`
- **Multer Config:** Increase `fileSize` limit from `10 * 1024 * 1024` (10MB) to `50 * 1024 * 1024` (50MB).
- **AI Prompt Engineering:** Update the Gemini prompt to explicitly instruct the model to identify distinct invoice boundaries within multi-page documents. Instruct the AI to output an array of distinct invoice objects under an `invoices` root property, including a `pageRange` field (e.g., "Page 1", "Pages 2-3") for each bill.
- **Gemini Response Schema:** Update `responseSchema` from a single object to an object containing an `invoices` array of objects.

---

### Frontend UI & Processing (`src/pages/UploadBatch.tsx`)

#### [MODIFY] `src/pages/UploadBatch.tsx`
- **UI Copy & Validation:** Update drag-and-drop text and file validation limits from 10MB to 50MB.
- **Dynamic Record Forking:** Modify `processFile` to handle `{ invoices: [...] }`.
  - For `invoices[0]`, update the initially created Firestore document, appending `(Bill 1, ${inv.pageRange})` to `fileName`.
  - For `invoices[1...N]`, dynamically create new Firestore documents in `organizations/${orgId}/invoices` with `fileName: ${file.name} (Bill ${i+1}, ${inv.pageRange})` and the shared `fileUrl`.

---

## Verification Plan

### Automated Tests
- Run `npm run lint` (`tsc --noEmit`) to verify TypeScript schema and property access correctness.

### Manual Verification
- Verify upload UI displays "Max 50MB per file".
- Upload a sample PDF containing multiple pages/bills and verify that multiple distinct invoice rows appear in the Recent Invoices dashboard.
