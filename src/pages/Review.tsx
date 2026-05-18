import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/src/lib/store';
import { db, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function Review() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { orgId } = useAuth();
  
  const [invoice, setInvoice] = useState<any>(null);
  const [editData, setEditData] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || !id) return;
    
    const fetchInvoice = async () => {
      try {
        const docRef = doc(db, `organizations/${orgId}/invoices`, id);
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
          const data = snapshot.data();
          setInvoice(data);
          setEditData(data);
        } else {
          toast.error('Invoice not found');
          navigate('/dashboard');
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `organizations/${orgId}/invoices/${id}`);
      } finally {
        setLoading(false);
      }
    };
    
    fetchInvoice();
  }, [id, orgId]);

  const handleChange = (field: string, value: any) => {
    setEditData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleSave = async (status: string) => {
    if (!orgId || !id) return;
    try {
      const docRef = doc(db, `organizations/${orgId}/invoices`, id);

      if (status === 'Approved') {
        const fieldsToTrack = [
          'vendorName', 'vendorGSTIN', 'buyerGSTIN', 'invoiceNumber', 'invoiceDate',
          'taxableAmount', 'cgst', 'sgst', 'igst', 'roundOff', 'grandTotal', 'gstRate'
        ];
        
        for (const field of fieldsToTrack) {
          const original = invoice?.[field] === undefined ? "" : invoice[field];
          const corrected = editData?.[field] === undefined ? "" : editData[field];
          
          if (original !== corrected && String(corrected).trim() !== '') {
            try {
               const { setDoc, increment } = await import('firebase/firestore');
               const vendorName = editData?.vendorName || invoice?.vendorName || 'Unknown';
               const safeId = btoa(unescape(encodeURIComponent(`${vendorName}:${field}:${original}:${corrected}`)))
                  .replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '').substring(0, 500);
                  
               const correctionRef = doc(db, `organizations/${orgId}/corrections_log`, safeId);
               await setDoc(correctionRef, {
                  vendor_name: vendorName,
                  field_name: field,
                  original_value: String(original),
                  corrected_value: String(corrected),
                  occurrence_count: increment(1),
                  updated_at: Date.now()
               }, { merge: true });
            } catch(e) {
               console.error("Error logging correction", e);
            }
          }
        }
      }

      await updateDoc(docRef, { ...editData, status });
      toast.success('Invoice saved');
      navigate('/dashboard');
    } catch (e) {
      toast.error('Failed to save invoice');
      console.error(e);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      // Ignore if pressing modifier keys like Ctrl or Cmd
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      
      const key = e.key.toLowerCase();
      if (key === 'a') {
        e.preventDefault();
        handleSave('Approved');
      } else if (key === 'f') {
        e.preventDefault();
        handleSave('Failed');
      } else if (key === 's') {
        e.preventDefault();
        navigate('/dashboard'); // Skip this invoice for now
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editData, invoice, orgId, id, navigate]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (!invoice) return null;

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col space-y-6 max-h-screen">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Review: {invoice.fileName}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/dashboard')} title="Skip (S)">Skip (S)</Button>
          <Button variant="outline" onClick={() => handleSave('Ready for Review')}>Save Draft</Button>
          <Button variant="destructive" onClick={() => handleSave('Failed')} title="Flag Details (F)">Flag Details (F)</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleSave('Approved')} title="Approve (A)">Approve (A)</Button>
        </div>
      </div>
      
      <div className="flex-1 grid md:grid-cols-2 gap-6 min-h-0">
        <Card className="h-full flex flex-col border shadow-sm overflow-hidden">
          <CardHeader className="py-3 px-4 border-b bg-neutral-50"><CardTitle className="text-sm font-medium">Original Document</CardTitle></CardHeader>
          <CardContent className="flex-1 p-0 overflow-auto bg-neutral-200 flex items-center justify-center relative">
            {invoice.fileType === 'application/pdf' ? (
              <iframe src={`${invoice.fileUrl}#toolbar=0`} className="w-full h-full border-0 absolute inset-0" title="Invoice" />
            ) : invoice.fileUrl ? (
              <img src={invoice.fileUrl} alt="Invoice" className="max-w-full h-auto" />
            ) : (
              <div className="text-neutral-500">No document to display</div>
            )}
          </CardContent>
        </Card>
        
        <Card className="h-full flex flex-col border shadow-sm">
          <CardHeader className="py-3 px-4 border-b bg-neutral-50 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Extracted Data</CardTitle>
            {invoice.confidenceScore !== undefined && (
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                invoice.confidenceScore > 80 ? 'bg-emerald-100 text-emerald-700' : 
                invoice.confidenceScore > 50 ? 'bg-amber-100 text-amber-700' : 
                'bg-red-100 text-red-700'
              }`}>
                {invoice.confidenceScore}% Confidence
              </span>
            )}
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-6 space-y-6">
            
            {invoice.status === 'Failed' && (
              <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700 space-y-2">
                <p className="font-bold flex items-center"><span className="text-lg mr-2">❌</span> Extraction Failed</p>
                <p>{invoice.errorDetails || "An unknown error occurred during extraction."}</p>
                <p className="text-xs opacity-80 mt-2">You can review the original document on the left and input the data manually, or flag the invoice.</p>
              </div>
            )}

            {invoice.validationErrors && invoice.validationErrors.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 space-y-1">
                <p className="font-semibold">Validation Issues:</p>
                <ul className="list-disc pl-5">
                  {invoice.validationErrors.map((err: string, i: number) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Vendor Name</Label>
                <Input value={editData.vendorName || ''} onChange={(e) => handleChange('vendorName', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Vendor GSTIN</Label>
                <Input value={editData.vendorGSTIN || ''} onChange={(e) => handleChange('vendorGSTIN', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Buyer GSTIN</Label>
                <Input value={editData.buyerGSTIN || ''} onChange={(e) => handleChange('buyerGSTIN', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Invoice Number</Label>
                <Input value={editData.invoiceNumber || ''} onChange={(e) => handleChange('invoiceNumber', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Invoice Date</Label>
                <Input value={editData.invoiceDate || ''} placeholder="YYYY-MM-DD" onChange={(e) => handleChange('invoiceDate', e.target.value)} />
              </div>
            </div>

            <div className="border-t pt-4 grid grid-cols-2 gap-4">
               <div className="space-y-1">
                <Label>Taxable Amount</Label>
                <Input type="number" value={editData.taxableAmount || ''} onChange={(e) => handleChange('taxableAmount', parseFloat(e.target.value))} />
              </div>
              <div className="space-y-1">
                <Label>GST Rate (%)</Label>
                <Input type="number" value={editData.gstRate || ''} onChange={(e) => handleChange('gstRate', parseFloat(e.target.value))} />
              </div>
              <div className="space-y-1">
                <Label>CGST</Label>
                <Input type="number" value={editData.cgst || ''} onChange={(e) => handleChange('cgst', parseFloat(e.target.value))} />
              </div>
              <div className="space-y-1">
                <Label>SGST</Label>
                <Input type="number" value={editData.sgst || ''} onChange={(e) => handleChange('sgst', parseFloat(e.target.value))} />
              </div>
              <div className="space-y-1">
                <Label>IGST</Label>
                <Input type="number" value={editData.igst || ''} onChange={(e) => handleChange('igst', parseFloat(e.target.value))} />
              </div>
              <div className="space-y-1">
                <Label>Round Off</Label>
                <Input type="number" value={editData.roundOff || ''} onChange={(e) => handleChange('roundOff', parseFloat(e.target.value))} />
              </div>
              <div className="space-y-1">
                <Label className="font-bold text-gray-900">Grand Total</Label>
                <Input type="number" className="font-bold bg-neutral-50" value={editData.grandTotal || ''} onChange={(e) => handleChange('grandTotal', parseFloat(e.target.value))} />
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <Label className="font-bold text-gray-900">Line Items</Label>
              {(!editData.lineItems || editData.lineItems.length === 0) ? (
                <div className="text-sm text-gray-500 italic">No line items extracted.</div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-neutral-50 text-neutral-600 border-b">
                      <tr>
                        <th className="px-4 py-2 font-medium">Description</th>
                        <th className="px-4 py-2 font-medium w-24">Qty</th>
                        <th className="px-4 py-2 font-medium w-24">Rate</th>
                        <th className="px-4 py-2 font-medium w-32">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y relative">
                      {editData.lineItems.map((item: any, idx: number) => {
                        return (
                        <tr key={idx} className="bg-white">
                          <td className="px-2 py-1"><Input className="h-8 shadow-none" value={item.description || ''} onChange={(e) => {
                            const newItems = [...editData.lineItems];
                            newItems[idx].description = e.target.value;
                            setEditData({ ...editData, lineItems: newItems });
                          }} /></td>
                          <td className="px-2 py-1"><Input className="h-8 shadow-none w-20" type="number" value={item.quantity || ''} onChange={(e) => {
                            const newItems = [...editData.lineItems];
                            newItems[idx].quantity = Number(e.target.value);
                            setEditData({ ...editData, lineItems: newItems });
                          }} /></td>
                          <td className="px-2 py-1"><Input className="h-8 shadow-none w-20" type="number" value={item.rate || ''} onChange={(e) => {
                            const newItems = [...editData.lineItems];
                            newItems[idx].rate = Number(e.target.value);
                            setEditData({ ...editData, lineItems: newItems });
                          }} /></td>
                          <td className="px-2 py-1"><Input className="h-8 shadow-none w-24" type="number" value={item.amount || ''} onChange={(e) => {
                            const newItems = [...editData.lineItems];
                            newItems[idx].amount = Number(e.target.value);
                            setEditData({ ...editData, lineItems: newItems });
                          }} /></td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
