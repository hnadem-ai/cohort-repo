const mongoose = require('mongoose');

const userSchema = mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  username: {
    type: String,
    required: true,
    trim: true
  },
  about: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true, // no duplicate emails
    lowercase: true
  },
  password_hash: {
    type: String,
    required: true,
  },
  dob: {
    type: Date,
  },
  status: {
    type: String,
    enum: ['active', 'warned', 'banned', 'deleted'],
    default: 'active',
  },
  dp: {
    type: String,
    default: 'https://pub-b873809749434f37903a2292617a1f53.r2.dev/user-dp/mascot%20for%20PFPs.png'
  },
  chat_requests: [{ type: mongoose.Types.ObjectId, ref: 'Chat' }]
  ,
  friends: [ { type: mongoose.Types.ObjectId, ref: 'User' } ]
  ,
  isVerified: { type: Boolean, default: false },
  verificationCode: String,
  verificationExpires: Date,
  passwordChangeCode: String,
  passwordChangeExpires: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema);