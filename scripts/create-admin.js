#!/usr/bin/env node
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { isSqlMode, connectSql, closeSql } = require('../db/sql');
const User = require('../models/User');

const getArg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index > -1) return process.argv[index + 1];
  return null;
};

const username = getArg('username');
const email = getArg('email');
const password = getArg('password');
const promote = process.argv.includes('--promote');

const usage = () => {
  console.log('用法: node scripts/create-admin.js --username USER --email EMAIL --password PASS [--promote]');
};

const connect = async () => {
  if (isSqlMode()) {
    await connectSql();
    return;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('缺少 MONGODB_URI 环境变量');
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
};

const close = async () => {
  if (isSqlMode()) {
    await closeSql();
    return;
  }
  await mongoose.connection.close();
};

const main = async () => {
  if (!username || !email || !password) {
    usage();
    process.exit(1);
  }

  await connect();

  const existingByUsername = await User.findOne({ username });
  const existingByEmail = existingByUsername ? null : await User.findOne({ email });
  const existing = existingByUsername || existingByEmail;

  if (existing) {
    if (!promote) {
      throw new Error('用户已存在，如需提升为管理员，请添加 --promote');
    }

    existing.role = 'admin';
    existing.status = 'approved';
    existing.isActive = true;
    existing.emailVerified = true;
    existing.approvedAt = new Date();
    existing.approvedBy = 'script';
    await existing.save();
    console.log(`已将用户 ${existing.username} 提升为管理员`);
    await close();
    return;
  }

  const user = new User({
    username,
    email,
    password,
    role: 'admin',
    status: 'approved',
    isActive: true,
    emailVerified: true,
    approvedAt: new Date(),
    approvedBy: 'script',
    profile: {}
  });

  await user.save();
  console.log(`已创建管理员账号：${username}`);
  await close();
};

main().catch(async (error) => {
  console.error('创建管理员失败:', error.message);
  try {
    await close();
  } catch (err) {
    // ignore
  }
  process.exit(1);
});
