const crypto = require('crypto');

let mysql;
try {
  mysql = require('mysql2/promise');
} catch (error) {
  mysql = null;
}

const isSqlMode = () => String(process.env.DB_MODE || '').toLowerCase() === 'sql';

let pool;

const getPool = () => {
  if (!isSqlMode()) return null;
  if (!mysql) {
    throw new Error('SQL mode requires mysql2. Run `npm install` in backend after package.json is updated.');
  }
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'environment_site',
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
      charset: 'utf8mb4'
    });
  }
  return pool;
};

const connectSql = async () => {
  const db = getPool();
  await db.query('SELECT 1');
  console.log(`SQL Connected: ${process.env.DB_HOST || '127.0.0.1'} / ${process.env.DB_NAME || 'environment_site'}`);
};

const closeSql = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

const createId = () => crypto.randomBytes(12).toString('hex');

module.exports = {
  isSqlMode,
  getPool,
  connectSql,
  closeSql,
  createId
};
