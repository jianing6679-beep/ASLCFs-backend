const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
      bufferMaxEntries: 0,
    };

    if (process.env.NODE_ENV === 'production') {
      options.ssl = true;
      options.sslValidate = true;
      options.sslCA = process.env.SSL_CA_CERT;
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, options);

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    console.log(`Database: ${conn.connection.name}`);

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB 连接错误:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB 连接已断开');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB 重新连接成功');
    });

    return conn;

  } catch (error) {
    console.error('数据库连接失败:', error.message);
    process.exit(1);
  }
};

const checkDBHealth = async () => {
  try {
    const db = mongoose.connection.db;
    await db.admin().ping();
    return { status: 'healthy', latency: 0 };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
};

module.exports = {
  connectDB,
  checkDBHealth
};
