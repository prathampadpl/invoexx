import { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, db } from '@/src/lib/firebase';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setLoading(true);
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      const userRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(userRef);
      
      if (!docSnap.exists()) {
        const orgId = crypto.randomUUID(); // Simplification: auto-create an org for the user on signup
        const batch = writeBatch(db);
        
        batch.set(userRef, {
          name: user.displayName || 'User',
          email: user.email,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastOrgId: orgId
        });
        
        batch.set(doc(db, 'organizations', orgId), {
          name: `${user.displayName || 'My'}'s Org`,
          ownerId: user.uid,
          createdAt: Date.now()
        });
        
        batch.set(doc(db, `organizations/${orgId}/members`, user.uid), {
          email: user.email,
          role: 'admin',
          createdAt: Date.now()
        });

        await batch.commit();
      }
      
      toast.success('Logged in successfully');
      navigate('/dashboard');
    } catch (e: any) {
      toast.error(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm border bg-white shadow-sm p-8 rounded-xl text-center space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
          <p className="text-neutral-500 text-sm mt-2">Sign in to manage your invoices</p>
        </div>
        <Button onClick={handleLogin} disabled={loading} className="w-full">
          {loading ? 'Signing in...' : 'Sign in with Google'}
        </Button>
      </div>
    </div>
  );
}
