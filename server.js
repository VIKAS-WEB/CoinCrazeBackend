const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // For environment variables

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// ⚠️ Files are stored locally in "uploads/" — not persistent on cloud platforms like Railway
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
const uri = process.env.MONGO_URI;
mongoose
  .connect(uri)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  phoneNumber: { type: String, required: true },
  password: { type: String, required: true },
  profilePicture: { type: String },
  kyc: {
    personalInfo: {
      FirstName: String,
      LastName: String,
      dob: String,
      phone: String,
    },
    idProof: {
      country: String,
      documentType: String,
      frontImagePath: String,
      backImagePath: String,
    },
    bankDetails: {
      bankName: String,
      accountNumber: String,
      ifsc: String,
    },
    kycCompleted: { type: Boolean, default: false },
  },
});

const User = mongoose.model('User', userSchema, 'users');

// Routes

app.post('/signup', async (req, res) => {
  try {
    const { email, phoneNumber, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ email, phoneNumber, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: 'User created successfully', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Email not found' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Incorrect password' });
    res.status(200).json({ message: 'Login successful', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/users', async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/submit-kyc', upload.fields([{ name: 'frontImage' }, { name: 'backImage' }]), async (req, res) => {
  try {
    const { userId, personalInfo, idProof, bankDetails } = req.body;
    const frontImagePath = req.files['frontImage']?.[0]?.path || null;
    const backImagePath = req.files['backImage']?.[0]?.path || null;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.kyc.personalInfo = JSON.parse(personalInfo);
    user.kyc.idProof = {
      ...JSON.parse(idProof),
      frontImagePath,
      backImagePath,
    };
    user.kyc.bankDetails = JSON.parse(bankDetails);
    user.kyc.kycCompleted = true;
    user.markModified('kyc');

    await user.save();
    res.status(200).json({ message: 'KYC submitted successfully', user });
  } catch (error) {
    res.status(400).json({ error: 'Failed to submit KYC', details: error.message });
  }
});

app.post('/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
  try {
    const { userId } = req.body;
    const profilePicturePath = req.file?.path || null;
    if (!profilePicturePath) return res.status(400).json({ error: 'No file uploaded' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.profilePicture = profilePicturePath;
    await user.save();
    res.status(200).json({ message: 'Profile picture uploaded successfully', profilePicturePath });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
