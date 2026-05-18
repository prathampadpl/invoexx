# INVOEX SaaS Multi-Bill PDF Separation & Scaling Walkthrough

**Date:** May 18, 2026  
**Target Codebase:** `c:\Users\prath\Downloads\invoex`  

---

## Executive Summary
This walkthrough details the architectural enhancements implemented to support large enterprise PDF uploads (up to 50MB) and intelligent AI-driven separation of multi-bill PDF documents into distinct Firestore invoice records for human verification.

---

## 🛠️ Changes Made

### 1. Backend API Scaling & AI Prompt Engineering (`server.ts`)
- **Multer Upload Scaling:** Increased the file size limit from 10MB to 50MB (`50 * 1024 * 1024`) to accommodate large, high-resolution multi-page PDF scans.
- **Multimodal AI Prompt Upgrade:** Instructed Gemini 2.5 Flash to scan the entire uploaded document, identify visual dividers or page boundaries between distinct bills, and extract each bill independently.
- **Structured Response Schema:** Modified the Gemini JSON `responseSchema` to return an `invoices` array of objects, where each object contains the extracted bill data along with a `pageRange` identifier (e.g., `"Page 1"`, `"Pages 2-3"`).

```diff
// server.ts
- const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
+ const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });
```

---

### 2. Dynamic Record Forking (`src/pages/UploadBatch.tsx`)
- **UI Copy & Validation:** Updated drag-and-drop messaging and file selection validation to permit up to 50MB per file.
- **Dynamic Document Forking:** Enhanced `processFile` to iterate over the `invoices` array returned by the API.
  - For `invoices[0]`, updates the initially created Firestore document, appending `(Bill 1, Page 1)` to `fileName`.
  - For `invoices[1...N]`, dynamically creates new, independent documents in `organizations/${orgId}/invoices` with `fileName: ${file.name} (Bill ${i+1}, ${inv.pageRange})`.
  - Shared Storage Link: All forked documents retain the exact same `fileUrl`, allowing the human verifier to inspect the original consolidated PDF for every bill in the verification dashboard (`Review.tsx`).

```diff
// UploadBatch.tsx
+ const invoiceList = Array.isArray(data?.invoices) ? data.invoices : [data];
+ for (let idx = 0; idx < invoiceList.length; idx++) {
+   let currentInvoiceRef = idx > 0 ? doc(collection(db, `organizations/${orgId}/invoices`)) : invoiceRef;
+   await setDoc(currentInvoiceRef, { ...processedData, fileName: file.name + billLabel, fileUrl }, { merge: true });
+ }
```

---

## 🧪 What Was Tested & Validation Results

### Automated Verification
- **TypeScript & Linting:** Executed `npm run lint` (`tsc --noEmit`).
  - **Result:** `Exit code: 0` (PASSED). Zero TypeScript errors or warning flags across the entire codebase.

### Flow Verification
- **50MB Upload Allowance:** Verified that the UI correctly displays `Max 50MB per file` and accepts larger PDF documents without throwing client-side validation errors.
- **Document Forking Logic:** Verified that the iteration loop correctly handles both single-invoice responses (legacy fallback) and multi-invoice arrays, accurately assigning `fileName` labels and preserving the shared `fileUrl`.

---

## 🚀 Next Steps
The INVOEX platform now fully supports large-scale, multi-bill consolidated PDF processing, empowering enterprise accounting teams to upload massive batch scans for automated AI separation and human-in-the-loop verification.
