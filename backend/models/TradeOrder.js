const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  coinName: {
    type: String,
    required: true, // e.g., 'BTC-USD'
  },
  orderType: {
    type: String,
    enum: ['Market', 'Limit', 'Stop-Loss'],
    required: true,
  },
  side: {
    type: String,
    enum: ['Buy', 'Sell'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  price: {
    type: Number, // Required for Limit/Stop-Loss
  },
  stopPrice: {
    type: Number, // Required for Stop-Loss
  },
  status: {
    type: String,
    enum: ['Open', 'Filled', 'Cancelled'],
    default: 'Open',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  executedAt: {
    type: Date,
  },
});

module.exports = mongoose.model('Order', OrderSchema);