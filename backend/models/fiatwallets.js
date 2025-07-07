const mongoose = require('mongoose');

const WalletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  currency: { type: String, 
    required: [true, 'Currency is required'],
    trim: true,
    uppercase: true,
    match: [/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code (e.g., USD, INR)'] }, // Add more currencies as needed
  balance: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

console.log('Wallet model loaded'); 
module.exports = mongoose.model('Wallet', WalletSchema);  