const mongoose = require('mongoose');

const cryptoWalletAddressSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  coinName: { 
    type: String, 
    required: true,
    index: true 
  },
  walletAddress: { 
    type: String, 
    required: true,
    unique: true 
  },
  mnemonic: { 
    type: String,
    select: false // Never return this in queries
  },
  vaultAccountId: { 
    type: String,
    required: true 
  },
  balance: { 
    type: Number, 
    default: 0,
    min: 0 
  }
}, { 
  timestamps: true, // Adds createdAt and updatedAt automatically
  optimisticConcurrency: true, // Prevents race conditions
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound unique index to prevent duplicate wallets per user
cryptoWalletAddressSchema.index(
  { userId: 1, coinName: 1 }, 
  { 
    unique: true, 
    name: 'user_coin_unique',
    partialFilterExpression: { coinName: { $exists: true } }
  }
);

// Add a pre-save hook to validate
cryptoWalletAddressSchema.pre('save', async function(next) {
  const existingWallet = await this.constructor.findOne({
    userId: this.userId,
    coinName: this.coinName,
    _id: { $ne: this._id } // Exclude current document if updating
  });

  if (existingWallet) {
    const err = new Error(`Wallet for ${this.coinName} already exists for this user`);
    err.name = 'DuplicateWalletError';
    return next(err);
  }
  next();
});

module.exports = mongoose.model('CryptoWalletAddress', cryptoWalletAddressSchema);