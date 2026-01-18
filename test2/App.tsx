import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Home } from './components/Home';
import { CameraView } from './components/CameraView';

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/camera/:deviceKey" element={<CameraView />} />
      </Routes>
    </HashRouter>
  );
};

export default App;