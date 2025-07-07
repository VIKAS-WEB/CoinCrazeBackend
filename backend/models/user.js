const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  phoneNumber: { type: String, required: true },
  password: { type: String, required: true },
  profilePicture: { type: String },
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

module.exports = mongoose.model('User', userSchema, 'users');