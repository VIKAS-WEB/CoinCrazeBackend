const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user');
const authMiddleware = require('../middleware/auth');

// Update Security Settings (2FA, Biometric Auth)
router.put('/update-security', authMiddleware, async (req, res) => {
  const { twoFactorAuth, biometricAuth } = req.body;
  const userId = req.user.userId;

  try {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findOne({ _id: userId }).session(session);
      if (!user) {
        await session.abortTransaction();
        return res.status(404).json({
          status: 404,
          message: 'User not found',
        });
      }

      user.securitySettings = {
        twoFactorAuth: twoFactorAuth ?? user.securitySettings.twoFactorAuth,
        biometricAuth: biometricAuth ?? user.securitySettings.biometricAuth,
      };
      await user.save({ session });

      await session.commitTransaction();
      res.status(200).json({
        status: 200,
        message: 'Security settings updated successfully',
        data: user.securitySettings,
      });
    } catch (error) {
      await session.abortTransaction();
      console.error('Error updating security settings:', error.message);
      res.status(500).json({
        status: 500,
        message: 'Failed to update security settings',
        error: error.message,
      });
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error('Error in update-security:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// Change PIN/Password
router.put('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.userId;

  try {
    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        status: 400,
        message: 'Current password and new password are required',
      });
    }

    // Password strength validation (optional, but recommended)
    if (newPassword.length < 8) {
      return res.status(400).json({
        status: 400,
        message: 'New password must be at least 8 characters long',
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findOne({ _id: userId }).session(session);
      if (!user) {
        await session.abortTransaction();
        return res.status(404).json({
          status: 404,
          message: 'User not found',
        });
      }

      // Verify current password using existing comparePassword method
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        await session.abortTransaction();
        return res.status(401).json({
          status: 401,
          message: 'Current password is incorrect',
        });
      }

      // Update password (will be hashed by pre-save hook)
      user.password = newPassword;
      await user.save({ session });

      await session.commitTransaction();
      res.status(200).json({
        status: 200,
        message: 'Password changed successfully',
      });
    } catch (error) {
      await session.abortTransaction();
      console.error('Error changing password:', error.message);
      res.status(500).json({
        status: 500,
        message: 'Failed to change password',
        error: error.message,
      });
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error('Error in change-password:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// Update App Preferences (Theme, Language, Currency)
router.put('/update-preferences', authMiddleware, async (req, res) => {
  const { theme, language, currency } = req.body;
  const userId = req.user.userId;

  try {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findOne({ _id: userId }).session(session);
      if (!user) {
        await session.abortTransaction();
        return res.status(404).json({
          status: 404,
          message: 'User not found',
        });
      }

      user.preferences = {
        theme: theme ?? user.preferences.theme,
        language: language ?? user.preferences.language,
        currency: currency ?? user.preferences.currency,
      };
      await user.save({ session });

      await session.commitTransaction();
      res.status(200).json({
        status: 200,
        message: 'Preferences updated successfully',
        data: user.preferences,
      });
    } catch (error) {
      await session.abortTransaction();
      console.error('Error updating preferences:', error.message);
      res.status(500).json({
        status: 500,
        message: 'Failed to update preferences',
        error: error.message,
      });
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error('Error in update-preferences:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// Update Notification Preferences (Price Alerts)
router.put('/update-notifications', authMiddleware, async (req, res) => {
  const { priceAlerts } = req.body;
  const userId = req.user.userId;

  try {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findOne({ _id: userId }).session(session);
      if (!user) {
        await session.abortTransaction();
        return res.status(404).json({
          status: 404,
          message: 'User not found',
        });
      }

      user.notificationPreferences = {
        priceAlerts: priceAlerts ?? user.notificationPreferences.priceAlerts,
      };
      await user.save({ session });

      await session.commitTransaction();
      res.status(200).json({
        status: 200,
        message: 'Notification preferences updated successfully',
        data: user.notificationPreferences,
      });
    } catch (error) {
      await session.abortTransaction();
      console.error('Error updating notification preferences:', error.message);
      res.status(500).json({
        status: 500,
        message: 'Failed to update notification preferences',
        error: error.message,
      });
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error('Error in update-notifications:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// Fetch KYC Status
router.get('/kyc-status', authMiddleware, async (req, res) => {
  const userId = req.user.userId;

  try {
    const user = await User.findOne({ _id: userId }).select('kyc');
    if (!user) {
      return res.status(404).json({
        status: 404,
        message: 'User not found',
      });
    }

    res.status(200).json({
      status: 200,
      message: 'KYC status fetched successfully',
      data: {
        kycCompleted: user.kyc?.kycCompleted ?? false,
        status: user.kyc?.kycCompleted ? 'Verified' : 'Not Started',
      },
    });
  } catch (error) {
    console.error('Error fetching KYC status:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Failed to fetch KYC status',
      error: error.message,
    });
  }
});

// Logout (Invalidate Token)
router.post('/logout', authMiddleware, async (req, res) => {
  const userId = req.user.userId;

  try {
    // Assuming token blacklisting or session management if needed
    // For simplicity, return success
    res.status(200).json({
      status: 200,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Error in logout:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Failed to logout',
      error: error.message,
    });
  }
});

// Fetch App Version
router.get('/app-version', async (req, res) => {
  try {
    const appVersion = 'v1.0.0'; // Static or fetch from config
    res.status(200).json({
      status: 200,
      message: 'App version fetched successfully',
      data: { version: appVersion },
    });
  } catch (error) {
    console.error('Error fetching app version:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Failed to fetch app version',
      error: error.message,
    });
  }
});

// Fetch Privacy Policy
router.get('/privacy-policy', async (req, res) => {
  try {
    const privacyPolicy = {
      title: 'Privacy Policy',
      content: 'This is the privacy policy for Coin Craze...',
      // Add actual content or fetch from CMS
    };
    res.status(200).json({
      status: 200,
      message: 'Privacy policy fetched successfully',
      data: privacyPolicy,
    });
  } catch (error) {
    console.error('Error fetching privacy policy:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Failed to fetch privacy policy',
      error: error.message,
    });
  }
});

// Fetch All Settings
router.get('/settings', authMiddleware, async (req, res) => {
  const userId = req.user.userId;

  try {
    const user = await User.findOne({ _id: userId }).select('email phoneNumber kyc securitySettings preferences notificationPreferences');
    if (!user) {
      return res.status(404).json({
        status: 404,
        message: 'User not found',
      });
    }

    res.status(200).json({
      status: 200,
      message: 'Settings fetched successfully',
      data: {
        email: user.email,
        phoneNumber: user.phoneNumber,
        kyc: {
          kycCompleted: user.kyc?.kycCompleted ?? false,
          status: user.kyc?.kycCompleted ? 'Verified' : 'Not Started',
        },
        securitySettings: user.securitySettings,
        preferences: user.preferences,
        notificationPreferences: user.notificationPreferences,
      },
    });
  } catch (error) {
    console.error('Error fetching settings:', error.message);
    res.status(500).json({
      status: 500,
      message: 'Failed to fetch settings',
      error: error.message,
    });
  }
});

module.exports = router;