import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import UserProfile from './pages/UserProfile';
import UploadVideoPage from "./pages/UploadVideoPage";
import VideoWatch from "./pages/VideoWatch";
import Activate from './pages/Activate';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path ="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/home" element={<Home />} />
        <Route path="/profile/:userId" element={<UserProfile />} />
        <Route path="/upload" element={<UploadVideoPage />} />
        <Route path="/videos/:id" element={<VideoWatch />} />
        <Route path="/activate/:token" element={<Activate />} />
      </Routes>
    </Router>
  );
}

export default App;
