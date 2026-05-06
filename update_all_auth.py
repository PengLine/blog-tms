#!/usr/bin/env python3
"""
批量更新TMS系统中的所有认证相关代码
将内联的认证函数和直接使用localStorage的代码替换为common.js中的通用函数
"""

import os
import re

# 需要更新的HTML文件列表
def find_html_files():
    """查找所有HTML文件"""
    html_files = []
    for file in os.listdir(os.path.dirname(__file__)):
        if file.endswith('.html'):
            html_files.append(file)
    return html_files

def update_file(file_path):
    """更新单个HTML文件"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 1. 替换直接获取用户信息的代码为getCurrentUser()
        content = re.sub(r'const user = JSON\.parse\(localStorage\.getItem\(\'tmsUser\'\)\);', 
                        'const user = getCurrentUser();', 
                        content)
        
        # 2. 替换内联的checkLoginStatus函数
        check_login_pattern = r'function checkLoginStatus\(\) \{[\s\S]*?\}'
        content = re.sub(check_login_pattern, '', content)
        
        # 3. 替换内联的logout函数
        logout_pattern = r'function logout\(\) \{[\s\S]*?\}'
        content = re.sub(logout_pattern, '', content)
        
        # 4. 替换内联的用户信息显示代码
        user_display_pattern = r'document\.getElementById\([\'"](current-role|current-username|currentUser)[\'"]\)\.textContent = userInfo\.username;'
        content = re.sub(user_display_pattern, 'displayCurrentUser();', content)
        
        # 5. 确保在DOMContentLoaded中调用正确的函数
        # 替换checkLoginStatus()为checkLoginStatus('admin')
        content = re.sub(r'checkLoginStatus\(\);', 'checkLoginStatus(\'admin\');', content)
        
        # 6. 确保在DOMContentLoaded中调用displayCurrentUser()
        # 查找是否已经有displayCurrentUser()调用
        if 'displayCurrentUser()' not in content:
            # 在logout()调用后添加displayCurrentUser()
            content = re.sub(r'(document\.getElementById\([\'\"]logout-btn[\'\"\)]\.addEventListener\([\'\"]click[\'\"\), \(\) => \{[\s\S]*?logout\(\);[\s\S]*?\}\);)', 
                            r'\1\n\n            // 显示当前用户名\n            displayCurrentUser();', 
                            content)
        
        # 写入更新后的内容
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f"更新成功: {file_path}")
    except Exception as e:
        print(f"更新失败: {file_path} - {e}")

if __name__ == "__main__":
    # 获取所有HTML文件
    html_files = find_html_files()
    
    # 遍历所有需要更新的文件
    for file_name in html_files:
        # 跳过登录页面，因为它的逻辑不同
        if file_name == 'index.html':
            continue
        
        file_path = os.path.join(os.path.dirname(__file__), file_name)
        if os.path.exists(file_path):
            update_file(file_path)
        else:
            print(f"文件不存在: {file_path}")
