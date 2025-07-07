const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
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

router.post('/submit-kyc', authMiddleware, upload.fields([{ name: 'frontImage' }, { name: 'backImage' }]), async (req, res) => {
  try {
    const { personalInfo, idProof, bankDetails } = req.body;
    const frontImagePath = req.files['frontImage'] ? req.files['frontImage'][0].path : null;
    const backImagePath = req.files['backImage'] ? req.files['backImage'][0].path : null;

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let parsedPersonalInfo;
    try {
      parsedPersonalInfo = JSON.parse(personalInfo);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid personalInfo JSON' });
    }
    const parsedIdProof = JSON.parse(idProof);
    const parsedBankDetails = JSON.parse(bankDetails);

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
    user.markModified('kyc');

    await user.save();
    res.status(200).json({ message: 'KYC submitted successfully', user });
  } catch (error) {
    res.status(400).json({ error: 'Failed to submit KYC', details: error.message });
  }
});

module.exports = router;