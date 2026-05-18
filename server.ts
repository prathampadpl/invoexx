import express from "express";
import path from "path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import Tesseract from "tesseract.js";
import * as admin from 'firebase-admin';
import dotenv from "dotenv";

dotenv.config();

// Initialize Firebase Admin without credentials 
// (works in some GCP environments or we can pass projectId if we read from firebase-applet-config)
import fs from 'fs';
let projectId = 'demo-project';
try {
  const configStr = fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8');
  projectId = JSON.parse(configStr).projectId;
} catch (e) {}
if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const app = express();
const PORT = 3000;

const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const verifyToken = async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<any> => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    if (process.env.ALLOW_MOCK_AUTH === 'true') {
      (req as any).user = { uid: 'test-user-id', email: 'test@example.com' };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    if (process.env.ALLOW_MOCK_AUTH === 'true') {
      (req as any).user = { uid: 'test-user-id', email: 'test@example.com' };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

app.post("/api/extract", verifyToken, upload.single("file"), async (req, res): Promise<any> => {
  const t0 = performance.now();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    let { mimetype } = req.file;
    const { buffer, originalname, size } = req.file;

    console.log(`[API /extract] Received file: ${originalname} | Size: ${(size / 1024).toFixed(2)} KB | Base Mime: ${mimetype}`);

    // Fallback and normalize mimetype for common extensions if it's application/octet-stream
    if (mimetype === "application/octet-stream" || !mimetype) {
      if (originalname.toLowerCase().endsWith(".pdf")) mimetype = "application/pdf";
      else if (originalname.toLowerCase().endsWith(".png")) mimetype = "image/png";
      else if (originalname.toLowerCase().endsWith(".jpg") || originalname.toLowerCase().endsWith(".jpeg")) mimetype = "image/jpeg";
      else if (originalname.toLowerCase().endsWith(".webp")) mimetype = "image/webp";
    }

    // Layer 1: Tesseract OCR (Fast baseline text extraction with strict 2.5s timeout)
    let ocrText = "";
    if (mimetype.startsWith("image/")) {
      try {
         const ocrPromise = Tesseract.recognize(buffer, 'eng').then(res => res.data.text);
         const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Tesseract OCR timeout")), 2500));
         ocrText = await Promise.race([ocrPromise, timeoutPromise]);
         console.log(`[API /extract] OCR Text Length: ${ocrText.length}`);
      } catch (err: any) {
         console.warn(`[API /extract] Tesseract OCR skipped/timed out (${err.message}). Using Gemini native vision.`);
      }
    }

    // Layer 2: Gemini
    const { corrections, knownVendors } = req.body;

    let prompt = `You are INVOEX, a SaaS specialized in extracting Indian GST invoice data.
Please analyze this document entirely using your multimodal vision capabilities.
CRITICAL INSTRUCTION: A single uploaded document (such as a multi-page PDF or consolidated image) may contain MULTIPLE DIFFERENT BILLS/INVOICES.
You must analyze the entire document, identify the page boundaries or visual dividers between distinct bills, and extract EACH distinct bill as a separate invoice object within the root "invoices" array.

IMPORTANT RULES FOR EACH INVOICE:
1. Ignore superficial shipping labels or customer self-declarations. Seek out the actual "Tax Invoice", "Invoice", or "Bill of Supply" sections.
2. For each distinct bill identified, determine its page range or location within the document (e.g., "Page 1", "Pages 2-3", "Bill 1") and include it in the "pageRange" field.
3. If the invoice is handwritten, pay special attention to cursive handwriting, date variations (DD-MM-YYYY), and ambiguous numbers (1 vs 7, 0 vs 6, 5 vs S). For GSTINs, PAN has 4 digits (fix S/J to 5, O to 0).
4. MATH VALIDATION IS CRITICAL: Before finalizing ambiguous numbers, perform math validation (Quantity * Rate = Amount, Taxable + CGST + SGST = Grand Total). Use the correct mathematical result to guide your OCR.

Extract the data into a JSON object containing an "invoices" array. Each invoice object in the array MUST contain:
- vendorName (string)
- vendorGSTIN (string)
- buyerGSTIN (string)
- invoiceNumber (string)
- invoiceDate (string, format YYYY-MM-DD)
- taxableAmount (number)
- cgst (number)
- sgst (number)
- igst (number)
- grandTotal (number)
- roundOff (number)
- gstRate (number)
- lineItems: Array of objects with description (string), quantity (number), rate (number), amount (number). Combine multi-line descriptions into one string.
- confidenceScore (number between 0 and 100)
- doubtfulFields (array of strings for struggling fields)
- pageRange (string, e.g. "Page 1", "Pages 2-3")

Return ONLY a valid JSON object matching the root "invoices" array structure. If a field is missing, use null or 0.
`;

    if (corrections) {
      prompt += `\n\n${corrections}\n`;
    }

    if (knownVendors) {
      prompt += `\n\n${knownVendors}\n`;
    }

    if (ocrText) {
      prompt += `\n\nLAYER 1 RAW OCR TEXT (For Cross-Reference):\n${ocrText}\n`;
    }

    const part = {
      inlineData: {
        data: buffer.toString("base64"),
        mimeType: mimetype,
      },
    };

    const t1 = performance.now();
    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-2.5-flash", 
        contents: [{ role: "user", parts: [part, { text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
               invoices: {
                  type: Type.ARRAY,
                  items: {
                     type: Type.OBJECT,
                     properties: {
                        vendorName: { type: Type.STRING },
                        vendorGSTIN: { type: Type.STRING },
                        buyerGSTIN: { type: Type.STRING },
                        invoiceNumber: { type: Type.STRING },
                        invoiceDate: { type: Type.STRING },
                        taxableAmount: { type: Type.NUMBER },
                        cgst: { type: Type.NUMBER },
                        sgst: { type: Type.NUMBER },
                        igst: { type: Type.NUMBER },
                        grandTotal: { type: Type.NUMBER },
                        roundOff: { type: Type.NUMBER },
                        gstRate: { type: Type.NUMBER },
                        lineItems: {
                           type: Type.ARRAY,
                           items: {
                              type: Type.OBJECT,
                              properties: {
                                 description: { type: Type.STRING },
                                 quantity: { type: Type.NUMBER },
                                 rate: { type: Type.NUMBER },
                                 amount: { type: Type.NUMBER }
                              }
                           }
                        },
                        confidenceScore: { type: Type.NUMBER },
                        doubtfulFields: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING }
                        },
                        pageRange: { type: Type.STRING }
                     }
                  }
               }
            }
          }
        }
      });
    } catch (genErr: any) {
      console.error("Gemini API generateContent Error:", JSON.stringify(genErr, Object.getOwnPropertyNames(genErr), 2));
      return res.status(500).json({ error: `Gemini API Error: ${genErr.message || 'Unknown error'}` });
    }
    const t2 = performance.now();

    const jsonText = response.text;
    if (!jsonText) {
      console.error("No response from AI, response object:", JSON.stringify(response, null, 2));
      return res.status(500).json({ error: "No response from AI" });
    }
    const t3 = performance.now();

    // Extract JSON from markdown if present
    let cleanedJsonText = jsonText;
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      cleanedJsonText = jsonMatch[1];
    }
    cleanedJsonText = cleanedJsonText.trim();

    let parsed;
    try {
      parsed = JSON.parse(cleanedJsonText);
    } catch (e: any) {
      console.error("Failed to parse AI output as JSON.");
      console.error("Raw jsonText:", jsonText);
      console.error("Cleaned jsonText:", cleanedJsonText);
      console.error("JSON Parse error details:", e);
      return res.status(500).json({ 
        error: "Failed to parse AI output as JSON",
        details: e.message,
        rawOutput: jsonText.slice(0, 500)
      });
    }
    const t4 = performance.now();
    
    // Clean up line items to ensure numbers are parsed correctly even if returned as strings with commas
    if (parsed.lineItems && Array.isArray(parsed.lineItems)) {
      parsed.lineItems = parsed.lineItems.map((item: any) => {
        if (!item || typeof item !== 'object') {
          return { description: "Unknown Item", quantity: 1, rate: 0, amount: 0 };
        }
        const description = item.description ? String(item.description).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() : "Unknown Item";
        let quantity = typeof item.quantity === 'number' ? item.quantity : parseFloat(String(item.quantity || "0").replace(/[^0-9.-]+/g,"")) || 0;
        let rate = typeof item.rate === 'number' ? item.rate : parseFloat(String(item.rate || "0").replace(/[^0-9.-]+/g,"")) || 0;
        let amount = typeof item.amount === 'number' ? item.amount : parseFloat(String(item.amount || "0").replace(/[^0-9.-]+/g,"")) || 0;
        
        // Robust mapping: infer missing values if possible
        if (quantity === 0 && rate > 0 && amount > 0) {
          quantity = Number((amount / rate).toFixed(2));
        } else if (rate === 0 && quantity > 0 && amount > 0) {
          rate = Number((amount / quantity).toFixed(2));
        } else if (amount === 0 && quantity > 0 && rate > 0) {
          amount = Number((quantity * rate).toFixed(2));
        } else if (quantity === 0 && rate === 0 && amount > 0) {
          quantity = 1;
          rate = amount;
        }

        return { description, quantity, rate, amount };
      }).filter((item: any) => item.amount > 0 || item.description !== "Unknown Item");
    }
    
    // Add validation rules
    let validationErrors = [];
    
    function validateGSTIN(gstin: string | null | undefined, label: string) {
      if (!gstin) return;
      const g = gstin.toUpperCase().trim();
      if (g.length !== 15) {
        validationErrors.push(`Invalid ${label} GSTIN length`);
        return;
      }
      const pattern = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][Z][0-9A-Z]$/;
      if (!pattern.test(g)) {
        validationErrors.push(`Invalid ${label} GSTIN format`);
        return;
      }
      const stateCode = parseInt(g.substring(0, 2), 10);
      if ((stateCode < 1 || stateCode > 38) && stateCode !== 97 && stateCode !== 99) {
        validationErrors.push(`Invalid ${label} GSTIN State Code`);
      }
    }

    validateGSTIN(parsed.vendorGSTIN, "Vendor");
    validateGSTIN(parsed.buyerGSTIN, "Buyer");
    
    function parseNum(val: any): number {
      if (val === null || val === undefined || val === '') return 0;
      if (typeof val === 'number') return isNaN(val) ? 0 : val;
      let str = String(val).trim();
      if (str.match(/\.\d{3},\d{2}$/)) {
         str = str.replace(/\./g, '').replace(',', '.');
      } else {
         str = str.replace(/,/g, '');
      }
      const num = parseFloat(str);
      return isNaN(num) ? 0 : num;
    }

    const TOLERANCE = 2.0;

    const subtotal = parseNum(parsed.taxableAmount);
    const cgst = parseNum(parsed.cgst);
    const sgst = parseNum(parsed.sgst);
    const igst = parseNum(parsed.igst);
    const roundOff = parseNum(parsed.roundOff);
    const total = parseNum(parsed.grandTotal);

    if (parsed.lineItems && parsed.lineItems.length > 0) {
      const lineSum = parsed.lineItems.reduce((acc: number, item: any) => acc + parseNum(item.amount), 0);
      if (Math.abs(lineSum - subtotal) > TOLERANCE) {
        validationErrors.push("Line items amount != Taxable Amount");
      }
    }

    if (Math.abs((subtotal + cgst + sgst + igst + roundOff) - total) > TOLERANCE) {
      validationErrors.push("Taxable Amount + Taxes (CGST, SGST, IGST) != Grand Total");
    }

    if (total === 0 && subtotal === 0) {
      validationErrors.push("Grand Total and Taxable Amount are 0");
    }

    if ((cgst > 0 || sgst > 0) && igst > 0) {
      validationErrors.push("Cannot have both CGST/SGST and IGST");
    }
    if (parsed.gstRate && ![0, 5, 12, 18, 28].includes(parsed.gstRate)) {
      validationErrors.push("Invalid GST Rate");
    }
    if (igst === 0 && Math.abs(cgst - sgst) > 1) {
      validationErrors.push("CGST must equal SGST when IGST is not present");
    }
    
    if (parsed.invoiceDate) {
      // Clean and normalize date
      let rawDate = parsed.invoiceDate.replace(/\s/g, '');
      
      // If DD.MM.YY or DD/MM/YY or DD-MM-YY
      const ddmmyyMatch = rawDate.match(/^(\d{2})[\.\-\/](\d{2})[\.\-\/](\d{2})$/);
      if (ddmmyyMatch) {
         const yearPrefix = parseInt(ddmmyyMatch[3], 10) > 50 ? '19' : '20';
         rawDate = `${yearPrefix}${ddmmyyMatch[3]}-${ddmmyyMatch[2]}-${ddmmyyMatch[1]}`;
         parsed.invoiceDate = rawDate;
      } else {
        // If DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
        const ddmmyyyyMatch = rawDate.match(/^(\d{2})[\.\-\/](\d{2})[\.\-\/](\d{4})$/);
        if (ddmmyyyyMatch) {
           rawDate = `${ddmmyyyyMatch[3]}-${ddmmyyyyMatch[2]}-${ddmmyyyyMatch[1]}`;
           parsed.invoiceDate = rawDate; // update the payload so it stays fixed
        }
      }

      const date = new Date(rawDate);
      if (date && !isNaN(date.getTime()) && date > new Date()) {
        validationErrors.push("Invoice date is in the future");
      }
    }

    if (parsed.doubtfulFields && Array.isArray(parsed.doubtfulFields)) {
      parsed.doubtfulFields.forEach((field: string) => {
        if (field) validationErrors.push(`AI is uncertain about field: ${field}`);
      });
    }

    parsed.validationErrors = validationErrors;

    const t5 = performance.now();
    console.log(`[Metrics] ${req.file.originalname} | Total API Latency: ${Math.round(t5-t0)}ms
  - File/Setup: ${(t1-t0).toFixed(2)}ms
  - Gemini Flash: ${(t2-t1).toFixed(2)}ms
  - AI Output Reading: ${(t3-t2).toFixed(2)}ms
  - JSON Parsing: ${(t4-t3).toFixed(2)}ms
  - Post Processing & Validation: ${(t5-t4).toFixed(2)}ms`);

    res.json(parsed);
  } catch (err: any) {
    console.error("Extraction error:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});

// Setup error handler for multer and API errors
app.use("/api", (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("API Error Middleware caught:", err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message || "Internal API Error" });
  }
});

app.use("/api", (req, res) => {
  console.warn("Unhandled API route:", req.method, req.path);
  res.status(404).json({ error: "API route not found" });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port " + PORT);
  });
}

startServer();
