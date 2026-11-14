import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './firebase/AuthContext';
import { MotionProvider } from './motion/MotionProvider';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { applyTheme, getInitialTheme } from './utils/theme';

applyTheme(getInitialTheme());

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthProvider>
      <MotionProvider>
        <App />
      </MotionProvider>
    </AuthProvider>
  </ErrorBoundary>
);
