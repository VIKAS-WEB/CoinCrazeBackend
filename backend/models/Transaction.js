const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  type: { type: String, enum: ['deposit', 'withdraw', 'buy', 'sell', 'transfer'], required: true },
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
  gateway: { type: String, enum: ['stripe', 'razorpay', 'bank', 'internal'], required: true },
  gatewayId: { type: String }, // Stripe Payment Intent ID, Razorpay Payment ID, or bank transfer ID
  walletType: {
    type: String,
    enum: ['fiat', 'crypto'],
    default: 'fiat', // Add this to distinguish fiat vs crypto transactions
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Transaction', TransactionSchema);