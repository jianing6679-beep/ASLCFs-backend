const fs = require('fs').promises;
const path = require('path');

async function migrateData() {
  const dataDir = path.join(__dirname, '../../data');
  const emissionDir = path.join(dataDir, 'emission');

  console.log('开始数据迁移...');

  // 创建新目录
  try {
    await fs.mkdir(emissionDir, { recursive: true });
    console.log('✓ 创建 emission/ 目录');
  } catch (error) {
    console.error('创建目录失败:', error);
    return;
  }

  // 迁移现有年份目录
  const years = ['2014', '2015', '2016', '2017'];

  for (const year of years) {
    const oldPath = path.join(dataDir, year);
    const newPath = path.join(emissionDir, year);

    try {
      await fs.access(oldPath);
      await fs.rename(oldPath, newPath);
      console.log(`✓ 已迁移 ${year}/ 到 emission/${year}/`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`- ${year}/ 不存在，跳过`);
      } else {
        console.log(`✗ 迁移 ${year}/ 失败:`, error.message);
      }
    }
  }

  console.log('\n数据迁移完成！');
  console.log('\n新的目录结构：');
  console.log('data/');
  console.log('├── emission/            (排放数据)');
  console.log('│   ├── 2014/');
  console.log('│   ├── 2015/');
  console.log('│   ├── 2016/');
  console.log('│   └── 2017/');
}

migrateData().catch(error => {
  console.error('迁移过程出错:', error);
  process.exit(1);
});
