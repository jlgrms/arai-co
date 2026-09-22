import { RouterProvider } from 'react-router-dom';

import { AuthProvider } from '@/features/auth/auth-context';
import { Toaster } from '@/components/ui/sonner';
import { router } from '@/app/router';

function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster />
    </AuthProvider>
  );
}

export default App;
