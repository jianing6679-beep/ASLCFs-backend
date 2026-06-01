#!/usr/bin/env node

/**
 * API测试脚本
 * 用于测试后端API的基本功能
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000/api';

// 测试数据
const testUser = {
  username: 'testuser_' + Date.now(),
  email: `test${Date.now()}@nju.edu.cn`,
  password: 'TestPass123',
  confirmPassword: 'TestPass123',
  profile: {
    institution: 'Nanjing University',
    title: 'master'
  }
};

let authToken = '';

// HTTP请求辅助函数
function makeRequest(url, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const response = {
            status: res.statusCode,
            headers: res.headers,
            data: body ? JSON.parse(body) : null
          };
          resolve(response);
        } catch (error) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: body
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// 测试健康检查
async function testHealth() {
  console.log('\n🏥 测试健康检查...');
  try {
    const response = await makeRequest(BASE_URL + '/health');
    if (response.status === 200 && response.data.status === 'OK') {
      console.log('✅ 健康检查通过');
      return true;
    } else {
      console.log('❌ 健康检查失败');
      return false;
    }
  } catch (error) {
    console.log('❌ 健康检查错误:', error.message);
    return false;
  }
}

// 测试用户注册
async function testRegister() {
  console.log('\n📝 测试用户注册...');
  try {
    const response = await makeRequest(BASE_URL + '/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, testUser);

    if (response.status === 201 && response.data.token) {
      authToken = response.data.token;
      console.log('✅ 用户注册成功');
      return true;
    } else {
      console.log('❌ 用户注册失败:', response.data?.error || '未知错误');
      return false;
    }
  } catch (error) {
    console.log('❌ 注册请求错误:', error.message);
    return false;
  }
}

// 测试用户登录
async function testLogin() {
  console.log('\n🔐 测试用户登录...');
  try {
    const response = await makeRequest(BASE_URL + '/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, {
      username: testUser.username,
      password: testUser.password
    });

    if (response.status === 200 && response.data.token) {
      authToken = response.data.token;
      console.log('✅ 用户登录成功');
      return true;
    } else {
      console.log('❌ 用户登录失败:', response.data?.error || '未知错误');
      return false;
    }
  } catch (error) {
    console.log('❌ 登录请求错误:', error.message);
    return false;
  }
}

// 测试获取用户信息
async function testGetProfile() {
  console.log('\n👤 测试获取用户信息...');
  try {
    const response = await makeRequest(BASE_URL + '/auth/profile', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 200 && response.data.user) {
      console.log('✅ 获取用户信息成功');
      return true;
    } else {
      console.log('❌ 获取用户信息失败:', response.data?.error || '未知错误');
      return false;
    }
  } catch (error) {
    console.log('❌ 获取用户信息请求错误:', error.message);
    return false;
  }
}

// 测试API信息
async function testAPIInfo() {
  console.log('\n📚 测试API信息...');
  try {
    const response = await makeRequest(BASE_URL);
    if (response.status === 200 && response.data.message) {
      console.log('✅ API信息获取成功');
      return true;
    } else {
      console.log('❌ API信息获取失败');
      return false;
    }
  } catch (error) {
    console.log('❌ API信息请求错误:', error.message);
    return false;
  }
}

// 主测试函数
async function runTests() {
  console.log('🧪 开始API功能测试...');
  console.log('=' .repeat(50));

  const results = {
    health: await testHealth(),
    apiInfo: await testAPIInfo(),
    register: await testRegister(),
    login: await testLogin(),
    profile: await testGetProfile()
  };

  console.log('\n' + '='.repeat(50));
  console.log('📊 测试结果汇总:');

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  Object.entries(results).forEach(([test, passed]) => {
    const status = passed ? '✅' : '❌';
    console.log(`${status} ${test}: ${passed ? '通过' : '失败'}`);
  });

  console.log(`\n🎯 总体结果: ${passed}/${total} 测试通过`);

  if (passed === total) {
    console.log('🎉 所有测试通过！后端API工作正常。');
  } else {
    console.log('⚠️  部分测试失败，请检查后端服务。');
  }

  process.exit(passed === total ? 0 : 1);
}

// 检查服务器是否运行
function checkServer() {
  return new Promise((resolve) => {
    const req = http.request('http://localhost:5000/api/health', (res) => {
      resolve(true);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// 启动测试
async function startTests() {
  console.log('🔍 检查后端服务器状态...');

  const serverRunning = await checkServer();

  if (!serverRunning) {
    console.log('❌ 后端服务器未运行，请先启动服务器:');
    console.log('   cd backend && npm run dev');
    process.exit(1);
  }

  console.log('✅ 后端服务器正在运行');
  await runTests();
}

startTests().catch((error) => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
