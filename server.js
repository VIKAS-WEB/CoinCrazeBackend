const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const connectDB = require('./backend/config/db');

const app = express();

// Create uploads folder if it doesn't exist
const dir = './uploads';
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Connect to MongoDB
connectDB();

// Routes
app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api/kyc', require('./backend/routes/kyc'));
app.use('/api/profile', require('./backend/routes/profile'));
app.use('/api/wallet', require('./backend/routes/wallet'));
app.use('/api/settings', require('./backend/routes/SettingsPage'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));