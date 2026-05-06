#!/usr/bin/env python3
"""
批量更新TMS系统中的登录、退出和用户信息显示功能
将所有页面中的localStorage.getItem('tmsUser')替换为common.js中的通用函数
"""

import os
import re

# 需要更新的HTML文件列表
html_files = [
    'tms-claim.html',
    'tms-transport.html',
    'tms-exception.html',
    'tms-sorting.html',
    'tms-timing.html',
    'tms-operation.html',
    'tms-capacity.html',
    'tms-vehicle.html',
    'tms-warehouse.html',
    'tms-user.html',
    'tms-monitor.html',
    'client-branch.html',
    'tms-hr.html',
    'tms-performance.html',
    'tms-evaluation.html',
    'tms-material.html',
    'tms-administration.html',
    'tms-finance.html',
    'tms-service.html'
]

def update_file(file_path):
    """更新单个HTML文件"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 替换直接获取用户信息的代码为getCurrentUser()
        content = re.sub(r'const user = JSON\.parse\(localStorage\.getItem\(\'tmsUser\'\)\);', 
                        'const user = getCurrentUser();', 
                        content)
        
        # 写入更新后的内容
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f"更新成功: {file_path}")
    except Exception as e:
        print(f"更新失败: {file_path} - {e}")

if __name__ == "__main__":
    # 遍历所有需要更新的文件
    for file_name in html_files:
        file_path = os.path.join(os.path.dirname(__file__), file_name)
        if os.path.exists(file_path):
            update_file(file_path)
        else:
            print(f"文件不存在: {file_path}")
