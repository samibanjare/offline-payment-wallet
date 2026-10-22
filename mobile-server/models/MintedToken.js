const mongoose = require('mongoose');

const MintedTokenSchema = new mongoose.Schema(
  {
    tokenId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    issuedTo: {
      type: String,
      required: true,
      ref: 'User',
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Token amount must be at least 1'],
    },
    issuedAt: {
      type: Number,
      required: true,
    },
    expiresAt: {
      type: Number,
      required: true,
    },
    bankSignature: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('MintedToken', MintedTokenSchema);