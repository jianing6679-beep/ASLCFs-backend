#!/usr/bin/env node
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { isSqlMode, connectSql, closeSql } = require('../db/sql');
const User = require('../models/User');

const admins = [
  { username: 'admin01', email: 'admin01@example.com', password: 'R7vQp9Lx#3mN2sKa' },
  { username: 'admin02', email: 'admin02@example.com', password: 'T4nWc8Zy!6rH1pVb' },
  { username: 'admin03', email: 'admin03@example.com', password: 'M9xAe2Kq@7tLs5Dj' },
  { username: 'admin04', email: 'admin04@example.com', password: 'C6pRy4Vn#8wQz1Fu' },
  { username: 'admin05', email: 'admin05@example.com', password: 'H2sLm7Bx!9cTa4Pe' },
  { username: 'admin06', email: 'admin06@example.com', password: 'Z8dKp3Ny@5vRg6Wm' },
  { username: 'admin07', email: 'admin07@example.com', password: 'P5qXt9La#2nCb7Hs' },
  { username: 'admin08', email: 'admin08@example.com', password: 'W3mVr6Dz!8kYe1Qp' },
  { username: 'admin09', email: 'admin09@example.com', password: 'B7yNa4Kc@3sFx9Lt' },
  { username: 'admin10', email: 'admin10@example.com', password: 'L1tHg8Qw#6pMz2Vn' }
];

const connect = async () => {
  if (isSqlMode()) {
    await connectSql();
    return;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('Missing MONGODB_URI. Set DB_MODE=sql for SQL, or configure MongoDB.');
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log(`MongoDB Connected: ${mongoose.connection.host}`);
};

const close = async () => {
  if (isSqlMode()) {
    await closeSql();
    return;
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
};

const promoteUser = async (user, password) => {
  user.password = password;
  user.role = 'admin';
  user.status = 'approved';
  user.isActive = true;
  user.emailVerified = true;
  user.emailVerifyToken = null;
  user.emailVerifyExpires = null;
  user.passwordResetToken = null;
  user.passwordResetExpires = null;
  user.rejectedReason = null;
  user.rejectedAt = null;
  user.rejectedBy = null;
  user.approvedAt = new Date();
  user.approvedBy = 'batch-script';
  user.profile = user.profile || {};
  await user.save();
};

const createOrPromoteAdmin = async ({ username, email, password }) => {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existingByUsername = await User.findOne({ username }).select('+password');
  const existingByEmail = existingByUsername ? null : await User.findOne({ email: normalizedEmail }).select('+password');
  const existing = existingByUsername || existingByEmail;

  if (existing) {
    await promoteUser(existing, password);
    return 'updated';
  }

  const user = new User({
    username,
    email: normalizedEmail,
    password,
    role: 'admin',
    status: 'approved',
    isActive: true,
    emailVerified: true,
    approvedAt: new Date(),
    approvedBy: 'batch-script',
    profile: {}
  });
  await user.save();
  return 'created';
};

const main = async () => {
  await connect();

  const results = [];
  for (const admin of admins) {
    try {
      const status = await createOrPromoteAdmin(admin);
      results.push({ ...admin, status });
      console.log(`${status === 'created' ? 'CREATED' : 'UPDATED'} ${admin.username} <${admin.email}>`);
    } catch (error) {
      results.push({ ...admin, status: 'failed', error: error.message });
      console.error(`FAILED ${admin.username} <${admin.email}>: ${error.message}`);
    }
  }

  const created = results.filter(item => item.status === 'created').length;
  const updated = results.filter(item => item.status === 'updated').length;
  const failed = results.filter(item => item.status === 'failed').length;

  console.log('\nSummary');
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
  console.log('\nAdmin credentials');
  admins.forEach((admin) => {
    console.log(`${admin.username}\t${admin.email}\t${admin.password}`);
  });

  await close();

  if (failed > 0) process.exit(1);
};

main().catch(async (error) => {
  console.error('Batch admin creation failed:', error.message);
  try {
    await close();
  } catch (closeError) {
    // ignore close errors
  }
  process.exit(1);
});
