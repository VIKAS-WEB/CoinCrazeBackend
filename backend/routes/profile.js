const express = require('express');
const router = express.Router();
const multer = require('multer');
const User = require('../models/user');
const authMiddleware = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

router.post('/upload-profile-picture', authMiddleware, upload.single('profilePicture'), async (req, res) => {
  try {
    const profilePicturePath = req.file ? req.file.path : null;
    if (!profilePicturePath) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.profilePicture = profilePicturePath;
    await user.save();
    res.status(200).json({ message: 'Profile picture uploaded successfully', profilePicturePath });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;