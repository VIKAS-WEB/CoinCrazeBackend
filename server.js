const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
require('dotenv').config(); // For environment variables

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Ensure this folder exists
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Create uploads folder if it doesn't exist
const fs = require('fs');
const dir = './uploads'; // Fixed case to match Multer
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}

// Serve static files (for accessing uploaded images)
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
const uri = process.env.MONGO_URI || "mongodb+srv://vikas007:Vikas123@cluster0.yykzc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(uri)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error("MongoDB Connection Error:", err));

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  phoneNumber: { type: String, required: true },
  password: { type: String, required: true },
  profilePicture: { type: String }, // Added field for profile picture path
  kyc: {
    personalInfo: {
      FirstName: { type: String },
      LastName: { type: String },
      dob: { type: String },
      phone: { type: String },
    },
    idProof: {
      country: { type: String },
      documentType: { type: String },
      frontImagePath: { type: String },
      backImagePath: { type: String },
    },
    bankDetails: {
      bankName: { type: String },
      accountNumber: { type: String },
      ifsc: { type: String },
    },
    kycCompleted: { type: Boolean, default: false },
  },
});

const User = mongoose.model('User', userSchema, 'users');

// Sign-Up API with Password Hashing
app.post('/signup', async (req, res) => {
  try {
    const { email, phoneNumber, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ email, phoneNumber, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: 'User created successfully', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login API with Password Comparison
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Email not found' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect password' });
    }
    res.status(200).json({ message: 'Login successful', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch all users
app.get('/users', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch user by ID
app.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new user
app.post('/users', async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// KYC Submission Route
app.post('/submit-kyc', upload.fields([{ name: 'frontImage' }, { name: 'backImage' }]), async (req, res) => {
  try {
    const { userId, personalInfo, idProof, bankDetails } = req.body;
    console.log('Received personalInfo:', req.body.personalInfo); // Debug log
    const frontImagePath = req.files['frontImage'] ? req.files['frontImage'][0].path : null;
    const backImagePath = req.files['backImage'] ? req.files['backImage'][0].path : null;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let parsedPersonalInfo;
    try {
      parsedPersonalInfo = JSON.parse(personalInfo);
      console.log('Parsed personalInfo:', parsedPersonalInfo); // Debug log
    } catch (e) {
      console.error('JSON Parse Error:', e);
      return res.status(400).json({ error: 'Invalid personalInfo JSON' });
    }
    const parsedIdProof = JSON.parse(idProof);
    const parsedBankDetails = JSON.parse(bankDetails);

    // Explicitly update kyc fields
    user.kyc.personalInfo = {
      FirstName: parsedPersonalInfo.FirstName || '',
      LastName: parsedPersonalInfo.LastName || '',
      dob: parsedPersonalInfo.dob || '',
      phone: parsedPersonalInfo.phone || '',
    };
    user.kyc.idProof = {
      country: parsedIdProof.country || '',
      documentType: parsedIdProof.documentType || '',
      frontImagePath: frontImagePath,
      backImagePath: backImagePath,
    };
    user.kyc.bankDetails = {
      bankName: parsedBankDetails.bankName || '',
      accountNumber: parsedBankDetails.accountNumber || '',
      ifsc: parsedBankDetails.ifsc || '',
    };
    user.kyc.kycCompleted = true;
    user.markModified('kyc'); // Ensure Mongoose recognizes the update

    try {
      await user.save();
      console.log('User after save:', user); // Debug log
    } catch (saveError) {
      console.error('Save Error:', saveError);
      return res.status(500).json({ error: 'Failed to save user', details: saveError.message });
    }

    res.status(200).json({ message: 'KYC submitted successfully', user });
  } catch (error) {
    console.error('Error submitting KYC:', error);
    res.status(400).json({ error: 'Failed to submit KYC', details: error.message });
  }
});

// Profile Picture Upload Route
app.post('/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
  try {
    const { userId } = req.body;
    const profilePicturePath = req.file ? req.file.path : null;

    if (!profilePicturePath) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.profilePicture = profilePicturePath;
    await user.save();
    res.status(200).json({ message: 'Profile picture uploaded successfully', profilePicturePath });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(400).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));