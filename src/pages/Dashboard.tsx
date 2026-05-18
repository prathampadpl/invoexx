import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/src/lib/store';
import { db, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ChevronDown, Calendar, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts';

export default function Dashboard() {
  const { orgId } = useAuth();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!orgId) return;
    const path = `organizations/${orgId}/invoices`;
    const q = query(collection(db, path), orderBy('uploadedAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setInvoices(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return unsubscribe;
  }, [orgId]);

  const filteredInvoices = invoices.filter(inv => {
    if (statusFilter !== 'All statuses' && inv.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!inv.vendorName?.toLowerCase().includes(q) && !inv.invoiceNumber?.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const { approvedPercent, topVendors, dailyData } = useMemo(() => {
    let approved = 0;
    const vendors: Record<string, { count: number; confSum: number }> = {};
    const days: Record<string, { date: string; volume: number; approved: number; flagged: number }> = {};

    invoices.forEach(inv => {
      if (inv.status === 'Approved') approved++;
      
      if (inv.vendorName) {
        if (!vendors[inv.vendorName]) vendors[inv.vendorName] = { count: 0, confSum: 0 };
        vendors[inv.vendorName].count++;
        vendors[inv.vendorName].confSum += (inv.confidenceScore || 0);
      }

      if (inv.uploadedAt) {
        const d = new Date(inv.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (!days[d]) days[d] = { date: d, volume: 0, approved: 0, flagged: 0 };
        days[d].volume++;
        if (inv.status === 'Approved') days[d].approved++;
        else days[d].flagged++;
      }
    });

    const approvedPercent = invoices.length ? Math.round((approved / invoices.length) * 100) : 0;
    
    const topVendors = Object.entries(vendors)
      .map(([name, stats]) => ({ name, count: stats.count, avgConf: stats.confSum / stats.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const dailyData = Object.values(days).slice(-14);

    return { approvedPercent, topVendors, dailyData };
  }, [invoices]);

  return (
    <div className="space-y-8 max-w-[1200px] mx-auto pb-12">
      <div className="flex items-start justify-between">
        <div>
           <div className="text-blue-600 font-bold text-[10px] tracking-widest uppercase mb-1">Dashboard</div>
           <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-2">Invoice processing overview</h1>
           <p className="text-gray-500 text-sm">Review approvals, flagged bills, vendor patterns, and export-ready invoices.</p>
        </div>
        <div>
          <Button onClick={() => navigate('/upload')} className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm">
            Upload invoices
          </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="shadow-sm border-gray-200">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-600">Total Processed</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div className="text-3xl font-bold text-gray-900">{invoices.length}</div>
            <div className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">All time</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-gray-200">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-600">Auto-Approved</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div className="text-3xl font-bold text-gray-900">{invoices.filter(i => i.status === 'Approved').length}</div>
            <div className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{approvedPercent}%</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-gray-200">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-600">Flagged for Review</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div className="text-3xl font-bold text-gray-900">{invoices.filter(i => i.validationErrors?.length > 0 || i.status === 'Ready for Review').length}</div>
            <div className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Needs review</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-gray-200">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-600">Avg Confidence</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div className="text-3xl font-bold text-gray-900">
               {invoices.length ? (invoices.reduce((a, b) => a + (b.confidenceScore || 0), 0) / invoices.length).toFixed(1) : '0.0'}%
            </div>
            <div className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">AI score</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
         <Card className="shadow-sm border-gray-200 flex flex-col">
            <CardHeader>
              <CardTitle className="text-base font-bold text-gray-900">Processing Accuracy</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col items-center justify-center min-h-[200px] m-4 mt-0 rounded-lg bg-gray-50/50 pt-4">
               {dailyData.length > 0 ? (
                 <ResponsiveContainer width="100%" height={200}>
                   <AreaChart data={dailyData}>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                     <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                     <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                     <Area type="monotone" dataKey="approved" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                     <Area type="monotone" dataKey="flagged" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
                   </AreaChart>
                 </ResponsiveContainer>
               ) : (
                 <div className="text-xs text-gray-400">No data available</div>
               )}
               <div className="flex gap-4 mt-auto pt-2 mb-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="flex items-center text-emerald-600"><span className="w-2 h-2 rounded-full border border-current mr-1.5 bg-emerald-100"></span> approved</div>
                  <div className="flex items-center text-amber-600"><span className="w-2 h-2 rounded-full border border-current mr-1.5 bg-amber-100"></span> flagged</div>
               </div>
            </CardContent>
         </Card>
         <Card className="shadow-sm border-gray-200 flex flex-col">
            <CardHeader>
              <CardTitle className="text-base font-bold text-gray-900">Daily Volume</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col items-center justify-center min-h-[200px] m-4 mt-0 rounded-lg bg-gray-50/50 pt-4">
               {dailyData.length > 0 ? (
                 <ResponsiveContainer width="100%" height={200}>
                   <BarChart data={dailyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                     <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                     <Tooltip cursor={{ fill: '#f3f4f6' }} contentStyle={{ borderRadius: '8px', fontSize: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                     <Bar dataKey="volume" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
                   </BarChart>
                 </ResponsiveContainer>
               ) : (
                 <div className="text-xs text-gray-400">No data available</div>
               )}
            </CardContent>
         </Card>
      </div>

      <Card className="shadow-sm border-gray-200">
        <CardHeader>
          <CardTitle className="text-base font-bold text-gray-900">Top Vendors</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-gray-50 hover:bg-transparent">
                <TableHead className="text-[10px] font-bold text-gray-500 uppercase tracking-wider h-8">Vendor Name</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-500 uppercase tracking-wider h-8">Invoice Count</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-500 uppercase tracking-wider h-8">Avg Confidence</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-500 uppercase tracking-wider h-8 text-right px-4">Performance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
               {topVendors.length > 0 ? topVendors.map((vendor, idx) => (
                 <TableRow key={idx} className="group">
                   <TableCell className="font-semibold text-sm text-gray-900">{vendor.name}</TableCell>
                   <TableCell className="text-gray-600 font-medium">{vendor.count}</TableCell>
                   <TableCell>
                     <div className="flex items-center gap-2">
                       <span className="text-sm font-medium">{vendor.avgConf.toFixed(0)}%</span>
                       <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden hidden sm:block">
                         <div className={`h-full ${vendor.avgConf > 90 ? 'bg-emerald-500' : vendor.avgConf > 75 ? 'bg-blue-500' : 'bg-amber-500'}`} style={{ width: `${vendor.avgConf}%` }} />
                       </div>
                     </div>
                   </TableCell>
                   <TableCell className="text-right">
                     <Button variant="ghost" size="sm" onClick={() => {
                        setSearchQuery(vendor.name);
                     }} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-8 text-xs font-semibold px-3">
                       View History
                     </Button>
                   </TableCell>
                 </TableRow>
               )) : (
                 <TableRow>
                   <TableCell colSpan={4} className="text-center text-gray-400 py-12 text-sm bg-gray-50/50">No vendor data available yet.</TableCell>
                 </TableRow>
               )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm border-gray-200">
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between pb-4 gap-4">
          <div>
             <CardTitle className="text-base font-bold text-gray-900 mb-1">Recent Invoices</CardTitle>
             <p className="text-sm text-gray-500">Search, filter, review, and export recent bills.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <Input 
                 placeholder="Search invoice or vendor" 
                 className="pl-9 w-64 h-9 text-sm rounded-md border-gray-200"
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="relative">
               <select 
                 className="h-9 px-3 pr-8 rounded-md border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 appearance-none bg-white font-medium text-gray-700"
                 value={statusFilter}
                 onChange={(e) => setStatusFilter(e.target.value)}
               >
                 <option>All statuses</option>
                 <option>Pending</option>
                 <option>Extracting</option>
                 <option>Ready for Review</option>
                 <option>Approved</option>
                 <option>Failed</option>
               </select>
               <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 transform -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
            <div className="flex items-center border border-gray-200 rounded-md bg-white h-9">
              <div className="px-3 text-sm text-gray-500 font-medium flex items-center border-r border-gray-200 h-full">dd-mm-yyyy <Calendar className="w-4 h-4 ml-2 opacity-50"/></div>
              <div className="px-3 text-sm text-gray-500 font-medium flex items-center h-full">dd-mm-yyyy <Calendar className="w-4 h-4 ml-2 opacity-50"/></div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-gray-100">
                <TableHead className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Invoice #</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Vendor</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Date</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Confidence</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-500 uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInvoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-gray-400 py-12">
                     <div className="flex flex-col items-center justify-center">
                        <SlidersHorizontal className="w-6 h-6 mb-2 opacity-20" />
                        <span className="text-sm">No invoices match these filters.</span>
                     </div>
                  </TableCell>
                </TableRow>
              )}
              {filteredInvoices.map(inv => (
                <TableRow key={inv.id} className="border-gray-100">
                  <TableCell className="font-semibold text-gray-900 text-sm whitespace-nowrap">{inv.invoiceNumber || <span className="opacity-50">-</span>}</TableCell>
                  <TableCell className="font-medium text-gray-600 text-sm">{inv.vendorName || <span className="opacity-50">Unknown</span>}</TableCell>
                  <TableCell className="text-gray-500 text-sm whitespace-nowrap">{inv.invoiceDate || <span className="opacity-50">-</span>}</TableCell>
                  <TableCell>
                    <Badge variant={inv.status === 'Approved' ? 'default' : inv.status === 'Failed' ? 'destructive' : 'secondary'} className="rounded font-semibold text-xs shadow-none">
                      {inv.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {inv.confidenceScore !== undefined ? (
                      <span className={`text-sm font-semibold ${inv.confidenceScore > 80 ? 'text-emerald-600' : inv.confidenceScore > 50 ? 'text-amber-600' : 'text-red-600'}`}>
                        {inv.confidenceScore.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link to={`/review/${inv.id}`} className="text-sm font-semibold text-blue-600 hover:text-blue-800">
                      Review
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          <div className="flex items-center justify-between mt-4 text-xs font-medium text-gray-500 border-t border-gray-100 pt-4">
             <div>Showing {filteredInvoices.length} of {invoices.length} invoices</div>
             <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled className="h-8 rounded text-xs px-3">Previous</Button>
                <span>Page 1 of 1</span>
                <Button variant="outline" size="sm" disabled className="h-8 rounded text-xs px-3">Next</Button>
             </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
