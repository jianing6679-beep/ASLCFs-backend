const fs = require('fs/promises');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getPool, closeSql } = require('../db/sql');

async function main() {
  process.env.DB_MODE = 'sql';
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  const statements = schema
    .split(/;\s*(?:\r?\n|$)/)
    .map(item => item.trim())
    .filter(Boolean);

  const db = getPool();
  for (const statement of statements) {
    await db.query(statement);
  }
  await closeSql();
  console.log(`SQL schema initialized: ${process.env.DB_NAME || 'environment_site'}`);
}

main().catch(async (error) => {
  await closeSql().catch(() => {});
  console.error('SQL schema initialization failed:', error.message);
  process.exit(1);
});
