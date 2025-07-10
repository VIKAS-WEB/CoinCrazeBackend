const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

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
  securitySettings: {
    twoFactorAuth: { type: Boolean, default: false },
    biometricAuth: { type: Boolean, default: false },
  },
  preferences: {
    theme: { type: String, default: 'light' },
    language: { type: String, default: 'en' },
    currency: { type: String, default: 'USD' },
  },
  notificationPreferences: {
    priceAlerts: { type: Boolean, default: false },
  },
});

// Password hashing before saving
userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

// Method to compare password for login
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema, 'users');