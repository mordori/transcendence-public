import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from "./auth/AuthProvider";

import './index.css'
import App from './App.tsx'

import '@sitharaj08/gamify/style.css'; // removed @ts-ignore(from above line) due to npm run lint
import '@bwo-ui/core/styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
	 <AuthProvider>
      <App />
	 </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
