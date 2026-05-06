// TMS系统通用函数库

// 简单的字符串hash函数
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
}

// 省份首字母映射
const provinceMap = {
    '北京': 'BJ',
    '上海': 'SH',
    '广州': 'GZ',
    '深圳': 'SZ',
    '杭州': 'HZ',
    '南京': 'NJ'
};

// 生成订单号：HL+发货省份的首字母+时间戳+4位（用户ID的hash值）+4位随机数字
function generateOrderId(origin, userId = 'guest') {
    // 获取发货省份首字母
    const provinceCode = provinceMap[origin] || 'XX';
    
    // 获取时间戳
    const timestamp = Date.now();
    
    // 生成4位用户ID hash值
    const userHash = (hashCode(userId) % 10000).toString().padStart(4, '0');
    
    // 生成4位随机数字
    const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    
    // 组合订单号
    return `HL${provinceCode}${timestamp}${userHash}${randomNum}`;
}

// 生成运单号的辅助函数：WB + 10位订单号hash值 + 4位随机数
function generateWaybillNumber(orderId) {
    // 生成10位订单号hash值
    const orderHash = hashCode(orderId).toString().padStart(10, '0').slice(0, 10);
    
    // 生成4位随机数字
    const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    
    // 组合运单号
    return `WB${orderHash}${randomNum}`;
}

// 注入统一的按钮样式
function injectButtonStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* 统一按钮样式 */
        .btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9rem;
            font-weight: 500;
        }

        .btn-primary {
            background: #4ecdc4;
            color: white;
        }

        .btn-primary:hover {
            background: #45b7aa;
        }

        .btn-secondary {
            background: #9e9e9e;
            color: white;
        }

        .btn-secondary:hover {
            background: #757575;
        }

        .btn-success {
            background: #4caf50;
            color: white;
        }

        .btn-success:hover {
            background: #388e3c;
        }

        .btn-danger {
            background: #ff6b6b;
            color: white;
        }

        .btn-danger:hover {
            background: #ee5a5a;
        }

        .btn-warning {
            background: #ff9800;
            color: white;
        }

        .btn-warning:hover {
            background: #f57c00;
        }

        /* 按钮大小 */
        .btn-sm {
            padding: 0.3rem 0.6rem;
            font-size: 0.8rem;
        }

        .btn-lg {
            padding: 0.8rem 1.5rem;
            font-size: 1rem;
        }

        /* 按钮组 */
        .btn-group {
            display: flex;
            gap: 0.5rem;
        }
    `;
    document.head.appendChild(style);
}

// 页面加载时自动注入样式
document.addEventListener('DOMContentLoaded', injectButtonStyles);

// 用户登录功能
function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const roleBtn = document.querySelector('.role-btn.active');

    if (!roleBtn) {
        alert('请选择角色');
        return;
    }

    if (!username || !password) {
        alert('请输入用户名和密码');
        return;
    }

    const role = roleBtn.getAttribute('data-role');
    console.log('login - username:', username, 'role:', role);

    // 保存用户信息到localStorage
    const userInfo = {
        username: username,
        role: role
    };
    console.log('login - userInfo:', userInfo);
    localStorage.setItem('tmsUser', JSON.stringify(userInfo));
    console.log('login - localStorage.tmsUser:', localStorage.getItem('tmsUser'));

    // 根据角色跳转到对应页面
    const rolePages = {
        'client': 'client-index.html',
        'branch': 'branch-index.html',
        'admin': 'tms-index.html',
        'sorter': 'sorter-index.html',
        'transporter': 'transporter-index.html',
        'deliveryman': 'deliveryman-index.html'
    };

    window.location.href = rolePages[role];
}

// 检查用户登录状态
function checkLoginStatus(requiredRole) {
    const userStr = localStorage.getItem('tmsUser');
    console.log('checkLoginStatus - requiredRole:', requiredRole, 'userStr:', userStr);
    if (!userStr) {
        // 用户未登录，跳转到登录页面
        console.log('checkLoginStatus - no user found, redirecting to login');
        window.location.href = 'index.html';
        return;
    }

    const userData = JSON.parse(userStr);
    console.log('checkLoginStatus - userData:', userData);
    if (requiredRole && userData.role !== requiredRole) {
        // 角色不匹配，跳转到登录页面
        console.log('checkLoginStatus - role mismatch, redirecting to login');
        alert('您没有权限访问此页面');
        window.location.href = 'index.html';
        return;
    }

    console.log('checkLoginStatus - success, returning userData:', userData);
    return userData;
}

// 用户退出登录
function logout() {
    if (confirm('确定要退出登录吗？')) {
        console.log('logout - removing user from localStorage');
        localStorage.removeItem('tmsUser');
        console.log('logout - user removed, redirecting to login');
        window.location.href = 'index.html';
    }
}

// 获取当前登录用户信息
function getCurrentUser() {
    const userStr = localStorage.getItem('tmsUser');
    console.log('getCurrentUser - userStr:', userStr);
    const user = userStr ? JSON.parse(userStr) : null;
    console.log('getCurrentUser - user:', user);
    return user;
}

// 显示当前用户名
function displayCurrentUser() {
    const user = getCurrentUser();
    console.log('displayCurrentUser - user:', user);
    if (!user) return null;
    
    // 更新所有可能的用户名显示元素
    const usernameElements = [
        'currentUser',
        'current-username',
        'current-driver',
        'current-sorter',
        'driver',
        'current-role'
    ];
    
    let updated = false;
    usernameElements.forEach(elementId => {
        const element = document.getElementById(elementId);
        console.log('displayCurrentUser - elementId:', elementId, 'element:', element);
        if (element) {
            element.textContent = user.username;
            // 添加一些样式，确保元素可见
            element.style.display = 'inline-block';
            element.style.marginRight = '10px';
            element.style.fontWeight = 'bold';
            console.log('displayCurrentUser - updated element:', elementId, 'with username:', user.username);
            updated = true;
        }
    });
    
    // 如果没有找到任何用户名显示元素，尝试创建一个
    if (!updated) {
        console.log('displayCurrentUser - no username elements found, trying to create one');
        const userInfoDiv = document.querySelector('.user-info');
        if (userInfoDiv) {
            const logoutBtn = userInfoDiv.querySelector('#logout-btn');
            if (logoutBtn) {
                const usernameSpan = document.createElement('span');
                usernameSpan.textContent = user.username;
                usernameSpan.style.display = 'inline-block';
                usernameSpan.style.marginRight = '10px';
                usernameSpan.style.fontWeight = 'bold';
                userInfoDiv.insertBefore(usernameSpan, logoutBtn);
                console.log('displayCurrentUser - created username element with username:', user.username);
            }
        }
    }
    
    return user;
}

// 用户个人信息相关函数

// 保存用户个人信息
function saveUserProfile(profileData) {
    localStorage.setItem('tmsUserProfile', JSON.stringify(profileData));
    console.log('saveUserProfile - profileData:', profileData);
}

// 获取用户个人信息
function getUserProfile() {
    const profileStr = localStorage.getItem('tmsUserProfile');
    const profile = profileStr ? JSON.parse(profileStr) : {};
    console.log('getUserProfile - profile:', profile);
    return profile;
}

// 更新用户个人信息
function updateUserProfile(updates) {
    const profile = getUserProfile();
    const updatedProfile = { ...profile, ...updates };
    saveUserProfile(updatedProfile);
    console.log('updateUserProfile - updates:', updates, 'updatedProfile:', updatedProfile);
    return updatedProfile;
}

// 积分相关函数

// 初始化用户积分数据
function initUserPoints() {
    const pointsData = JSON.parse(localStorage.getItem('tmsUserPoints'));
    if (!pointsData) {
        const initialPoints = {
            balance: 0,
            history: []
        };
        localStorage.setItem('tmsUserPoints', JSON.stringify(initialPoints));
        console.log('initUserPoints - initialized with:', initialPoints);
        return initialPoints;
    }
    console.log('initUserPoints - existing pointsData:', pointsData);
    return pointsData;
}

// 获取用户积分余额
function getUserPointsBalance() {
    const pointsData = JSON.parse(localStorage.getItem('tmsUserPoints')) || initUserPoints();
    console.log('getUserPointsBalance - balance:', pointsData.balance);
    return pointsData.balance;
}

// 添加积分
function addUserPoints(amount, description) {
    const pointsData = JSON.parse(localStorage.getItem('tmsUserPoints')) || initUserPoints();
    pointsData.balance += amount;
    pointsData.history.unshift({
        id: Date.now(),
        type: 'earn',
        description: description,
        points: amount,
        date: new Date().toLocaleString()
    });
    localStorage.setItem('tmsUserPoints', JSON.stringify(pointsData));
    console.log('addUserPoints - amount:', amount, 'description:', description, 'new balance:', pointsData.balance);
    return pointsData.balance;
}

// 扣除积分
function deductUserPoints(amount, description) {
    const pointsData = JSON.parse(localStorage.getItem('tmsUserPoints')) || initUserPoints();
    if (pointsData.balance >= amount) {
        pointsData.balance -= amount;
        pointsData.history.unshift({
            id: Date.now(),
            type: 'spend',
            description: description,
            points: -amount,
            date: new Date().toLocaleString()
        });
        localStorage.setItem('tmsUserPoints', JSON.stringify(pointsData));
        console.log('deductUserPoints - amount:', amount, 'description:', description, 'new balance:', pointsData.balance);
        return true;
    }
    console.log('deductUserPoints - insufficient points:', pointsData.balance, 'needed:', amount);
    return false;
}

// 获取积分历史记录
function getUserPointsHistory() {
    const pointsData = JSON.parse(localStorage.getItem('tmsUserPoints')) || initUserPoints();
    console.log('getUserPointsHistory - history:', pointsData.history);
    return pointsData.history;
}

// 导出函数到全局作用域
window.hashCode = hashCode;
window.generateOrderId = generateOrderId;
window.generateWaybillNumber = generateWaybillNumber;
window.injectButtonStyles = injectButtonStyles;
window.login = login;
window.checkLoginStatus = checkLoginStatus;
window.logout = logout;
window.getCurrentUser = getCurrentUser;
window.displayCurrentUser = displayCurrentUser;
window.saveUserProfile = saveUserProfile;
window.getUserProfile = getUserProfile;
window.updateUserProfile = updateUserProfile;
window.initUserPoints = initUserPoints;
window.getUserPointsBalance = getUserPointsBalance;
window.addUserPoints = addUserPoints;
window.deductUserPoints = deductUserPoints;
window.getUserPointsHistory = getUserPointsHistory;
