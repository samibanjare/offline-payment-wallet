const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      default: 'App User',
      trim: true,
    },
    role: {
      type: String,
      enum: ['USER', 'MERCHANT', 'ADMIN'],
      default: 'USER',
    },
    fiatBalance: {
      type: Number,
      required: true,
      default: 5000.0,
      min: [0, 'Fiat balance cannot be negative'],
    },
    publicKey: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', UserSchema);