const mongoose = require('mongoose');

const RedeemedTokenSchema = new mongoose.Schema(
  {
    tokenId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    settledBy: {
      type: String,
      required: true,
      ref: 'User',
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Redeemed amount must be at least 1'],
    },
    settledAt: {
      type: Number,
      required: true,
    },
    rawAck: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('RedeemedToken', RedeemedTokenSchema);