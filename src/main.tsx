import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './firebase/AuthContext';
import { MotionProvider } from './motion/MotionProvider';

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <MotionProvider>
      <App />
    </MotionProvider>
  </AuthProvider>
);

