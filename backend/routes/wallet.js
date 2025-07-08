const express = require('express');
const router = express.Router();
const axios = require('axios');
const Stripe = require('stripe');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { FireblocksSDK } = require('fireblocks-sdk');
const { readFileSync } = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const CryptoWalletAddress = require('../models/CryptoWallet');
const Wallet = require('../models/fiatwallets');
const Transaction = require('../models/Transaction');
const User = require('../models/user');
const authMiddleware = require('../middleware/auth');
const Order = require('../models/TradeOrder');

// Fireblocks Configuration
const secretPath = path.resolve('fireblocks_secret6.key');
let fireblocks;
try {
  const apiSecret = readFileSync(secretPath, 'utf8');
  const apiKey = process.env.FIREBLOCKS_API_KEY;
  fireblocks = new FireblocksSDK(apiSecret, apiKey, 'https://sandbox-api.fireblocks.io');
  console.log('Fireblocks SDK initialized successfully');
} catch (error) {
  console.error('Failed to initialize Fireblocks SDK:', error.message);
  throw new Error('Fireblocks SDK initialization failed');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Debug
console.log('Wallet model in routes:', Wallet);

// Fetch Crypto Wallet Addresses
router.get('/fetchCryptoWalletAddresses', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('Fetching wallet addresses for user:', userId);

    const wallets = await CryptoWalletAddress.find({ userId }).select('coinName walletAddress createdAt -_id');
    if (!wallets || wallets.length === 0) {
      console.log('No wallets found for user:', userId);
      return res.status(404).json({
        status: 404,
        message: 'No wallet addresses found',
        data: [],
      });
    }

    const walletDetails = wallets.map(wallet => ({
      coinName: wallet.coinName,
      walletAddress: wallet.walletAddress,
      createdAt: wallet.createdAt,
    }));

    res.status(200).json({
      status: 200,
      message: 'Wallet addresses fetched successfully',
      data: walletDetails,
    });
  } catch (error) {
    console.error('Error fetching wallet addresses:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Failed to fetch wallet addresses',
      error: error.message,
    });
  }
});

// Fetch Crypto Wallet Balances
router.get('/fetchCryptoWalletBalances', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('Fetching wallet balances for user:', userId);

    const wallets = await CryptoWalletAddress.find({ userId }).select('coinName walletAddress createdAt balance -_id');
    if (!wallets || wallets.length === 0) {
      console.log('No wallets found for user:', userId);
      return res.status(404).json({
        status: 404,
        message: 'No wallet balances found',
        data: [],
      });
    }

    const walletDetails = wallets.map(wallet => ({
      coinName: wallet.coinName,
      walletAddress: wallet.walletAddress,
      createdAt: wallet.createdAt,
      balance: wallet.balance || 0.0, // Default to 0.0 if balance is undefined
    }));

    res.status(200).json({
      status: 200,
      message: 'Wallet balances fetched successfully',
      data: walletDetails,
    });
  } catch (error) {
    console.error('Error fetching wallet balances:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Failed to fetch wallet balances',
      error: error.message,
    });
  }
});

// Create Crypto Wallet
router.post('/createCryptoWallet', authMiddleware, async (req, res) => {
  const { coinName } = req.body;
  const userId = req.user.userId;

  try {
    // Fetch supported assets from Fireblocks
    const supportedAssets = await fireblocks.getSupportedAssets();
    if (!supportedAssets || supportedAssets.length === 0) {
      return res.status(500).json({ error: 'Failed to fetch supported assets' });
    }

    // Format coinName
    const cleanCoinName = coinName.replace('_TEST', '').toUpperCase();
    const formattedCoinName = `${cleanCoinName}_TEST`;

    // Match against nativeAsset
    const asset = supportedAssets.find(
      asset => asset.nativeAsset === formattedCoinName && !asset.deprecated
    );

    if (!asset) {
      return res.status(400).json({ error: `Unsupported or deprecated coin: ${coinName}` });
    }

    const assetId = asset.id;

    // Start Mongo session and transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        return res.status(404).json({ error: 'User not found' });
      }

      // Check if wallet already exists for this user and coin
      const existingWallet = await CryptoWalletAddress.findOne({
        userId,
        coinName: formattedCoinName
      }).session(session);

      if (existingWallet) {
        await session.abortTransaction();
        return res.status(400).json({
          error: `Wallet for ${coinName} already exists`,
          walletAddress: existingWallet.walletAddress,
        });
      }

      // Get or create vault account
      let vaultAccountId = user.vaultAccountId;
      if (!vaultAccountId) {
        vaultAccountId = await getOrCreateVaultAccount(user.email);
        if (!vaultAccountId) {
          await session.abortTransaction();
          return res.status(500).json({ error: 'Failed to create vault account' });
        }
        user.vaultAccountId = vaultAccountId;
        await user.save({ session });
      }

      // Create or fetch wallet address from Fireblocks
      const walletAddress = await createVaultWalletAddress(
        userId,
        assetId,
        vaultAccountId,
        formattedCoinName,
        session
      );

      if (!walletAddress) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Failed to generate wallet address' });
      }

      if (walletAddress === "Asset is deprecated. Use a different asset.") {
        await session.abortTransaction();
        return res.status(400).json({ error: walletAddress });
      }

      // ✅ Check if wallet address already exists for another coin
      const existingSameAddress = await CryptoWalletAddress.findOne({
        walletAddress
      }).session(session);

      if (existingSameAddress) {
        await session.abortTransaction();
        return res.status(400).json({
          error: `This wallet address is already assigned to ${existingSameAddress.coinName}. Cannot reuse.`,
          walletAddress
        });
      }

      // Create wallet entry
      const newWallet = new CryptoWalletAddress({
        userId,
        coinName: formattedCoinName,
        walletAddress,
        vaultAccountId,
        balance: 0.0,
      });

      await newWallet.save({ session });
      await session.commitTransaction();

      res.status(201).json({
        message: 'Wallet created successfully',
        walletAddress,
        coinName: formattedCoinName
      });

    } catch (error) {
      await session.abortTransaction();
      console.error('Transaction error:', error);
      res.status(500).json({ error: 'Wallet creation failed', details: error.message });
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error('Wallet creation failed:', error);
    res.status(500).json({
      error: 'Failed to create wallet',
      details: error.message
    });
  }
});

// Update Crypto Wallet Balance
router.post('/CryptoAmountUpdate', authMiddleware, async (req, res) => {
  const { userId, currency, address, amount } = req.body;

  // Validate request body
  if (!userId || !currency || !address || !amount || amount <= 0) {
    return res.status(400).json({
      status: 400,
      message: 'Missing or invalid parameters: userId, currency, address, and amount are required',
    });
  }

  // Ensure the authenticated user matches the provided userId
  if (userId !== req.user.userId) {
    return res.status(403).json({
      status: 403,
      message: 'Unauthorized: Cannot update wallet for another user',
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find the crypto wallet
    let wallet = await CryptoWalletAddress.findOne({
      userId,
      coinName: currency,
      walletAddress: address,
    }).session(session);

    if (!wallet) {
      await session.abortTransaction();
      return res.status(404).json({
        status: 404,
        message: 'Wallet not found for the specified user, currency, and address',
      });
    }

    // Update balance
    wallet.balance = (wallet.balance || 0) + amount;
    await wallet.save({ session });

    // Create a transaction record
    const transaction = new Transaction({
      userId,
      amount,
      currency,
      type: 'deposit',
      status: 'success',
      gateway: 'stripe',
      gatewayId: `stripe_deposit_${Date.now()}`,
      walletAddress: address,
      createdAt: new Date(),
    });
    await transaction.save({ session });

    await session.commitTransaction();

    // Format response to match CryptoWallet model expected by frontend
    res.status(200).json({
      _id: wallet._id,
      userId: wallet.userId,
      coinName: wallet.coinName,
      walletAddress: wallet.walletAddress,
      balance: wallet.balance,
      createdAt: wallet.createdAt,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error updating wallet balance:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Failed to update wallet balance',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
});

// New Route: Sell Crypto
// Updated Sell Crypto Route (Handles Market Orders)
router.post('/sellCrypto', authMiddleware, async (req, res) => {
  const { cryptoWalletId, fiatWalletId, cryptoAmount, fiatAmount, cryptoCurrency } = req.body;
  const userId = req.user.userId;

  try {
    if (!cryptoWalletId || !fiatWalletId || !cryptoAmount || !fiatAmount || !cryptoCurrency) {
      return res.status(400).json({
        status: 400,
        message: 'Missing required parameters: cryptoWalletId, fiatWalletId, cryptoAmount, fiatAmount, and cryptoCurrency are required',
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const cryptoWallet = await CryptoWalletAddress.findById(cryptoWalletId).session(session);
      if (!cryptoWallet || !cryptoWallet.userId.equals(userId)) {
        await session.abortTransaction();
        return res.status(404).json({
          status: 404,
          message: 'Crypto wallet not found or unauthorized',
        });
      }

      if (cryptoWallet.balance < cryptoAmount) {
        await session.abortTransaction();
        return res.status(400).json({
          status: 400,
          message: 'Insufficient balance in crypto wallet',
        });
      }

      const fiatWallet = await Wallet.findById(fiatWalletId).session(session);
      if (!fiatWallet || !fiatWallet.userId.equals(userId)) {
        await session.abortTransaction();
        return res.status(404).json({
          status: 404,
          message: 'Fiat wallet not found or unauthorized',
        });
      }

      cryptoWallet.balance -= cryptoAmount;
      fiatWallet.balance += fiatAmount;

      await cryptoWallet.save({ session });
      await fiatWallet.save({ session });

      const transaction = new Transaction({
        userId,
        amount: cryptoAmount,
        currency: cryptoCurrency,
        type: 'sell',
        status: 'success',
        gateway: 'internal',
        gatewayId: `sell_${cryptoWalletId}_${Date.now()}`,
        walletAddress: cryptoWallet.walletAddress,
        fiatAmount,
        fiatCurrency: fiatWallet.currency,
        createdAt: new Date(),
      });

      await transaction.save({ session });

      const order = new Order({
        userId,
        coinName: cryptoCurrency,
        orderType: 'Market',
        side: 'Sell',
        amount: cryptoAmount,
        price: fiatAmount / cryptoAmount, // Market price
        status: 'Filled',
        executedAt: new Date(),
      });

      await order.save({ session });
      await session.commitTransaction();

      return res.status(200).json({
        status: 200,
        message: 'Crypto sold successfully',
        data: {
          cryptoWallet: {
            _id: cryptoWallet._id,
            coinName: cryptoWallet.coinName,
            balance: cryptoWallet.balance,
          },
          fiatWallet: {
            _id: fiatWallet._id,
            currency: fiatWallet.currency,
            balance: fiatWallet.balance,
          },
          order: {
            _id: order._id,
            coinName: order.coinName,
            orderType: order.orderType,
            side: order.side,
            amount: order.amount,
            price: order.price,
            status: order.status,
          },
        },
      });
    } catch (error) {
      await session.abortTransaction();
      console.error('Error in sell transaction:', error.message);
      return res.status(500).json({
        status: 500,
        message: 'Failed to sell crypto',
        error: error.message,
      });
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error('Error in sell crypto route:', error.message);
    return res.status(500).json({
      status: 500,
      message: 'Internal server error',
      error: error.message,
    });
  }
});



async function getVaultAccountByName(email) {
  try {
    const vaultAccounts = await fireblocks.getVaultAccountsWithPageInfo({ namePrefix: email });

    if (vaultAccounts.accounts && vaultAccounts.accounts.length > 0) {
      // Find exact match (case insensitive)
      const vault = vaultAccounts.accounts.find(
        account => account.name.toLowerCase() === email.toLowerCase()
      );
      if (vault) {
        return vault.id;
      }
    }
    return null;
  } catch (error) {
    console.error('Error in getVaultAccountByName:', error);
    return null;
  }
}

// Helper Functions
async function getOrCreateVaultAccount(email) {
  try {
    const existingVaultId = await getVaultAccountByName(email);
    if (existingVaultId) return existingVaultId;

    const vaultAccount = await fireblocks.createVaultAccount({ name: email, autoFuel: false, hiddenOnUI: false });
    if (!vaultAccount || !vaultAccount.id) {
      throw new Error('Failed to create vault account: No vault ID returned');
    }
    return vaultAccount.id;
  } catch (error) {
    console.error('Vault account error at:', new Date().toISOString(), { error: error?.response?.data || error.message });
    return null;
  }
}

async function createVaultWalletAddress(userId, assetId, vaultAccountId, coinName, session) {
  try {
    // Validate if asset is supported
    const supportedAssets = await fireblocks.getSupportedAssets();
    const isSupported = supportedAssets.some(asset => asset.id === assetId && !asset.deprecated);
    if (!isSupported) {
      console.error(`Asset ${assetId} is deprecated or not supported`);
      return "Asset is deprecated. Use a different asset.";
    }

    let walletAddress;

    try {
      // Try to create new asset
      const vaultAsset = await fireblocks.createVaultAsset(vaultAccountId, assetId);
      walletAddress = vaultAsset?.address;
    } catch (error) {
      if (error?.response?.data?.code === 1026) {
        // Asset exists, fetch address
        const addresses = await fireblocks.getDepositAddresses(vaultAccountId, assetId);
        walletAddress = addresses[0]?.address;
      } else if (error?.response?.data?.message?.includes("deprecated")) {
        console.error(`Asset ${assetId} is deprecated`);
        return "Asset is deprecated. Use a different asset.";
      } else {
        console.error('Address creation failed:', error?.response?.data || error);
        return null;
      }
    }

    if (!walletAddress) return null;

    // Clean address format
    return walletAddress.includes(':')
      ? walletAddress.split(':')[1].trim()
      : walletAddress.trim();

  } catch (error) {
    console.error('Address creation failed:', error?.response?.data || error);
    return null;
  }
}

// Get Supported Assets
router.get('/getSupportedAssets', authMiddleware, async (req, res) => {
  try {
    const supportedAssets = await fireblocks.getSupportedAssets();
    if (!supportedAssets || supportedAssets.length === 0) {
      return res.status(404).json({
        status: 404,
        message: "No supported assets found.",
        data: [],
      });
    }
    console.log("Supported Assets Fetched:", supportedAssets.length);
    return res.status(200).json({
      status: 200,
      message: "Supported assets retrieved successfully.",
      data: supportedAssets,
    });
  } catch (error) {
    console.error("Error fetching supported assets:", error?.response?.data || error.message);
    return res.status(500).json({
      status: 500,
      message: "Failed to retrieve supported assets.",
      data: error?.response?.data || error.message,
    });
  }
});

// Get Fiat Wallet Balance
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const wallets = await Wallet.find({ userId: req.user.userId });
    res.json(wallets);
  } catch (err) {
    console.error('Error fetching fiat balance:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create Fiat Wallet
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { currency } = req.body;
    if (!currency) {
      return res.status(400).json({ error: 'Currency is required' });
    }

    const existingWallet = await Wallet.findOne({
      userId: req.user.userId,
      currency,
    });
    if (existingWallet) {
      return res.status(400).json({ error: `Wallet for ${currency} already exists` });
    }

    const wallet = new Wallet({
      userId: req.user.userId,
      currency,
      balance: 0,
    });
    await wallet.save();
    res.status(201).json({ message: 'Wallet created', wallet });
  } catch (err) {
    console.error('Error creating fiat wallet:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Add Funds (Stripe)
router.post('/add-money/stripe', authMiddleware, async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const userId = req.user.userId;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // Convert to cents
      currency,
      metadata: { userId },
    });

    const transaction = new Transaction({
      userId,
      amount,
      currency,
      type: 'deposit',
      status: 'pending',
      gateway: 'stripe',
      gatewayId: paymentIntent.id,
    });
    await transaction.save();

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Error in Stripe payment:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Add Funds (Razorpay)
router.post('/add-money/razorpay', authMiddleware, async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const userId = req.user.userId;

    const order = await razorpay.orders.create({
      amount: amount * 100, // Convert to paise
      currency,
      receipt: `receipt_${userId}_${Date.now()}`,
    });

    const transaction = new Transaction({
      userId,
      amount,
      currency,
      type: 'deposit',
      status: 'pending',
      gateway: 'razorpay',
      gatewayId: order.id,
    });
    await transaction.save();

    res.json({ orderId: order.id, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('Error in Razorpay payment:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Webhook for Stripe
router.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const { userId } = paymentIntent.metadata;

    const transaction = await Transaction.findOne({ gatewayId: paymentIntent.id });
    if (transaction && transaction.status === 'pending') {
      transaction.status = 'success';
      await transaction.save();

      let wallet = await Wallet.findOne({ userId, currency: transaction.currency });
      if (!wallet) {
        wallet = new Wallet({ userId, currency: transaction.currency, balance: 0 });
      }
      wallet.balance += transaction.amount;
      await wallet.save();
    }
  }

  res.json({ received: true });
});

// Webhook for Razorpay
router.post('/webhook/razorpay', async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const shasum = crypto.createHmac('sha256', secret);
  shasum.update(JSON.stringify(req.body));
  const digest = shasum.digest('hex');

  if (digest === req.headers['x-razorpay-signature']) {
    const { event, payload } = req.body;

    if (event === 'payment.authorized') {
      const payment = payload.payment.entity;
      const transaction = await Transaction.findOne({ gatewayId: payment.order_id });

      if (transaction && transaction.status === 'pending') {
        transaction.status = 'success';
        await transaction.save();

        let wallet = await Wallet.findOne({ userId: transaction.userId, currency: transaction.currency });
        if (!wallet) {
          wallet = new Wallet({ userId: transaction.userId, currency: transaction.currency, balance: 0 });
        }
        wallet.balance += transaction.amount;
        await wallet.save();
      }
    }
  }

  res.json({ status: 'ok' });
});

// Withdraw Funds
router.post('/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user || !user.kyc?.kycCompleted) {
      return res.status(400).json({ error: 'KYC not completed' });
    }

    let wallet = await Wallet.findOne({ userId, currency });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const transaction = new Transaction({
      userId,
      amount,
      currency,
      type: 'withdraw',
      status: 'pending',
      gateway: 'bank',
      gatewayId: `bank_${Date.now()}`,
    });
    await transaction.save();

    wallet.balance -= amount;
    await wallet.save();

    res.json({ message: 'Withdrawal initiated' });
  } catch (err) {
    console.error('Error in withdrawal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get Transaction History
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    res.json(transactions);
  } catch (err) {
    console.error('Error fetching transactions:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Convert Currency
router.get('/convert', async (req, res) => {
  const { from = 'usd', to = 'bitcoin', amount = 1 } = req.query;

  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: to.toLowerCase(),
        vs_currencies: from.toLowerCase(),
      },
    });

    if (!response.data[to.toLowerCase()]) {
      return res.status(400).json({ error: 'Invalid currency or crypto symbol' });
    }

    const rate = response.data[to.toLowerCase()][from.toLowerCase()];
    const cryptoAmount = parseFloat(amount) / rate;

    res.json({
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      rate,
      amount: parseFloat(amount),
      converted: parseFloat(cryptoAmount.toFixed(6)),
      inverseRate: rate,
    });
  } catch (err) {
    console.error('Conversion Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch conversion rate' });
  }
});

router.get('/supported-assets', authMiddleware, async (req, res) => {
  try {
    const assets = await fireblocks.getSupportedAssets();

    res.status(200).json({
      status: 200,
      message: 'Fetched supported assets from Fireblocks',
      data: assets.map(asset => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
      })),
    });
  } catch (error) {
    console.error('Error fetching supported assets:', error);
    res.status(500).json({
      status: 500,
      message: 'Failed to fetch supported assets',
      error: error.message,
    });
  }
});

// Fetch Complete Cryptocurrency Details
router.get('/fetchCompleteCryptoDetails', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('Fetching complete cryptocurrency details for user:', userId);

    // Fetch wallets and transactions in parallel
    const [wallets, transactions] = await Promise.all([
      CryptoWalletAddress.find({ userId }).select('_id userId coinName walletAddress vaultAccountId balance createdAt updatedAt __v'),
      Transaction.find({ userId, currency: { $in: await CryptoWalletAddress.distinct('coinName', { userId }) } })
        .select('amount currency type status gateway gatewayId walletAddress fiatAmount fiatCurrency createdAt -_id')
        .sort({ createdAt: -1 }),
    ]);

    if (!wallets || wallets.length === 0) {
      console.log('No wallets found for user:', userId);
      return res.status(404).json({
        status: 404,
        message: 'No cryptocurrency wallets found',
        data: [],
      });
    }

    // Map wallets to include their transactions
    const walletDetails = wallets.map(wallet => ({
      _id: wallet._id,
      userId: wallet.userId,
      coinName: wallet.coinName,
      walletAddress: wallet.walletAddress,
      vaultAccountId: wallet.vaultAccountId,
      balance: wallet.balance || 0,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      __v: wallet.__v,
      transactions: transactions
        .filter(tx => tx.currency === wallet.coinName || tx.walletAddress === wallet.walletAddress)
        .map(tx => ({
          amount: tx.amount,
          currency: tx.currency,
          type: tx.type,
          status: tx.status,
          gateway: tx.gateway,
          gatewayId: tx.gatewayId,
          walletAddress: tx.walletAddress,
          fiatAmount: tx.fiatAmount || null,
          fiatCurrency: tx.fiatCurrency || null,
          createdAt: tx.createdAt,
        })),
    }));

    res.status(200).json({
      status: 200,
      message: 'Cryptocurrency details fetched successfully',
      data: walletDetails,
    });
  } catch (error) {
    console.error('Error fetching cryptocurrency details:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Failed to fetch cryptocurrency details',
      error: error.message,
    });
  }
});

// New Route: Place Order (Market, Limit, Stop-Loss)
router.post('/placeOrder', authMiddleware, async (req, res) => {
  const { cryptoWalletId, fiatWalletId, coinName, orderType, side, amount, price, stopPrice } = req.body;
  const userId = req.user.userId;

  try {
    if (!cryptoWalletId || !fiatWalletId || !coinName || !orderType || !side || !amount) {
      return res.status(400).json({
        status: 400,
        message: 'Missing required parameters',
      });
    }

    if (orderType === 'Limit' && !price) {
      return res.status(400).json({
        status: 400,
        message: 'Price is required for Limit orders',
      });
    }

    if (orderType === 'Stop-Loss' && (!price || !stopPrice)) {
      return res.status(400).json({
        status: 400,
        message: 'Price and stopPrice are required for Stop-Loss orders',
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const cryptoWallet = await CryptoWalletAddress.findById(cryptoWalletId).session(session);
      if (!cryptoWallet || !cryptoWallet.userId.equals(userId)) {
        await session.abortTransaction();
        return res.status(404).json({
          status: 404,
          message: 'Crypto wallet not found or unauthorized',
        });
      }

      const fiatWallet = await Wallet.findById(fiatWalletId).session(session);
      if (!fiatWallet || !fiatWallet.userId.equals(userId)) {
        await session.abortTransaction();
        return res.status(404).json({
          status: 404,
          message: 'Fiat wallet not found or unauthorized',
        });
      }

      // Validate balances
      if (side === 'Buy' && fiatWallet.balance < (amount * price || 0)) {
        await session.abortTransaction();
        return res.status(400).json({
          status: 400,
          message: 'Insufficient fiat balance for Buy order',
        });
      }

      if (side === 'Sell' && cryptoWallet.balance < amount) {
        await session.abortTransaction();
        return res.status(400).json({
          status: 400,
          message: 'Insufficient crypto balance for Sell order',
        });
      }

      // For Market orders, execute immediately
      if (orderType === 'Market') {
        // Mapping Coinbase pair to CoinGecko ID
        const coinGeckoIdMap = {
          'BTC-USD': 'bitcoin',
          'ETH-USD': 'ethereum',
          'XRP-USD': 'ripple',
          'ADA-USD': 'cardano',
          'SOL-USD': 'solana',
          'DOT-USD': 'polkadot',
          'DOGE-USD': 'dogecoin',
          'BNB-USD': 'binancecoin',
          'LINK-USD': 'chainlink',
          'AVAX-USD': 'avalanche-2',
        };
        const coinGeckoId = coinGeckoIdMap[coinName] || coinName.split('-')[0].toLowerCase();

        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
          params: {
            ids: coinGeckoId,
            vs_currencies: 'usd',
          },
        });

        const marketPrice = response.data[coinGeckoId]?.usd;
        if (!marketPrice) {
          await session.abortTransaction();
          return res.status(500).json({
            status: 500,
            message: 'Failed to fetch market price',
          });
        }

        if (side === 'Buy') {
          fiatWallet.balance -= amount * marketPrice;
          cryptoWallet.balance += amount;
        } else {
          cryptoWallet.balance -= amount;
          fiatWallet.balance += amount * marketPrice;
        }

        await cryptoWallet.save({ session });
        await fiatWallet.save({ session });

        const transaction = new Transaction({
          userId,
          amount,
          currency: coinName,
          type: side.toLowerCase(),
          status: 'success',
          gateway: 'internal',
          gatewayId: `market_${cryptoWalletId}_${Date.now()}`,
          walletAddress: cryptoWallet.walletAddress,
          fiatAmount: amount * marketPrice,
          fiatCurrency: fiatWallet.currency,
          createdAt: new Date(),
        });

        await transaction.save({ session });

        const order = new Order({
          userId,
          coinName,
          orderType,
          side,
          amount,
          price: marketPrice,
          status: 'Filled',
          executedAt: new Date(),
        });

        await order.save({ session });
        await session.commitTransaction();

        return res.status(200).json({
          status: 200,
          message: `${side} order executed successfully`,
          data: {
            order: {
              _id: order._id,
              coinName: order.coinName,
              orderType: order.orderType,
              side: order.side,
              amount: order.amount,
              price: order.price,
              status: order.status,
            },
          },
        });
      } else {
        // For Limit/Stop-Loss, store order in DB
        const order = new Order({
          userId,
          coinName,
          orderType,
          side,
          amount,
          price,
          stopPrice: orderType === 'Stop-Loss' ? stopPrice : null,
          status: 'Open',
        });

        await order.save({ session });
        await session.commitTransaction();

        // Mock matching engine (replace with real logic)
        setTimeout(async () => {
          const session = await mongoose.startSession();
          session.startTransaction();
          try {
            const updatedOrder = await Order.findById(order._id).session(session);
            if (!updatedOrder || updatedOrder.status !== 'Open') {
              await session.commitTransaction();
              session.endSession();
              return;
            }

            const coinGeckoId = coinGeckoIdMap[coinName] || coinName.split('-')[0].toLowerCase();
            const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
              params: {
                ids: coinGeckoId,
                vs_currencies: 'usd',
              },
            });

            const marketPrice = response.data[coinGeckoId]?.usd;
            if (!marketPrice) {
              await session.commitTransaction();
              session.endSession();
              return;
            }

            let shouldExecute = false;
            if (orderType === 'Limit') {
              if (side === 'Buy' && marketPrice <= price) shouldExecute = true;
              if (side === 'Sell' && marketPrice >= price) shouldExecute = true;
            } else if (orderType === 'Stop-Loss' && side === 'Sell') {
              if (marketPrice <= stopPrice) shouldExecute = true;
            }

            if (shouldExecute) {
              const cryptoWallet = await CryptoWalletAddress.findById(cryptoWalletId).session(session);
              const fiatWallet = await Wallet.findById(fiatWalletId).session(session);

              if (side === 'Buy') {
                fiatWallet.balance -= amount * marketPrice;
                cryptoWallet.balance += amount;
              } else {
                cryptoWallet.balance -= amount;
                fiatWallet.balance += amount * marketPrice;
              }

              await cryptoWallet.save({ session });
              await fiatWallet.save({ session });

              updatedOrder.status = 'Filled';
              updatedOrder.price = marketPrice;
              updatedOrder.executedAt = new Date();
              await updatedOrder.save({ session });

              const transaction = new Transaction({
                userId,
                amount,
                currency: coinName,
                type: side.toLowerCase(),
                status: 'success',
                gateway: 'internal',
                gatewayId: `limit_${cryptoWalletId}_${Date.now()}`,
                walletAddress: cryptoWallet.walletAddress,
                fiatAmount: amount * marketPrice,
                fiatCurrency: fiatWallet.currency,
                createdAt: new Date(),
              });

              await transaction.save({ session });
              await session.commitTransaction();
            } else {
              await session.commitTransaction();
            }
          } catch (error) {
            await session.abortTransaction();
            console.error('Error matching order:', error.message);
          } finally {
            session.endSession();
          }
        }, 5000); // Check every 5 seconds (mock matching engine)

        return res.status(200).json({
          status: 200,
          message: `${orderType} ${side} order placed successfully`,
          data: {
            order: {
              _id: order._id,
              coinName: order.coinName,
              orderType: order.orderType,
              side: order.side,
              amount: order.amount,
              price: order.price,
              stopPrice: order.stopPrice,
              status: order.status,
            },
          },
        });
      }
    } catch (error) {
      await session.abortTransaction();
      console.error('Error placing order:', error.message);
      return res.status(500).json({
        status: 500,
        message: 'Failed to place order',
        error: error.message,
      });
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error('Error in place order route:', error.message);
    return res.status(500).json({
      status: 500,
      message: 'Internal server error',
      error: error.message,
    });
  }
});


// Fetch Orders
  router.get('/fetchSpotOrders', authMiddleware, async (req, res) => {
    try {
      const userId = req.user.userId;
      console.log('Fetching orders for user:', userId);

      const orders = await Order.find({ userId })
        .select('coinName orderType side amount price stopPrice status executedAt createdAt -_id')
        .sort({ createdAt: -1 });

      if (!orders || orders.length === 0) {
        console.log('No orders found for user:', userId);
        return res.status(404).json({
          status: 404,
          message: 'No orders found',
          data: [],
        });
      }

      res.status(200).json({
        status: 200,
        message: 'Orders fetched successfully',
        data: orders,
      });
    } catch (error) {
      console.error('Error fetching orders:', error.message);
      res.status(500).json({
        status: 500,
        message: 'Failed to fetch orders',
        error: error.message,
      });
    }
  });


module.exports = router;