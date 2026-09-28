import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { detectHostMode } from './hostMode';

import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App hostMode={detectHostMode(window)} />
  </React.StrictMode>,
);
