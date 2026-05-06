// 分拣员角色示例数据生成脚本
// 为所有分拣员页面生成真实的示例数据

class SorterMockDataGenerator {
    constructor() {
        this.currentDate = new Date();
        this.currentYear = this.currentDate.getFullYear();
        this.currentMonth = this.currentDate.getMonth() + 1;
        this.today = this.currentDate.toISOString().split('T')[0];
    }

    // 生成今日统计数据
    generateTodayStats() {
        const statsKey = `sorterStats_${this.today}`;
        
        const mockStats = {
            scanned: Math.floor(Math.random() * 50) + 100,
            sorted: Math.floor(Math.random() * 40) + 90,
            exceptions: Math.floor(Math.random() * 5)
        };
        
        localStorage.setItem(statsKey, JSON.stringify(mockStats));
        console.log('今日统计数据生成完成:', mockStats);
    }

    // 生成月度绩效数据
    generateMonthlyPerformance() {
        const performanceKey = `sorterPerformance_${this.currentYear}_${this.currentMonth}`;
        
        const mockPerformance = {
            total: Math.floor(Math.random() * 20) + 80,
            totalScans: Math.floor(Math.random() * 1000) + 2000,
            totalSorted: Math.floor(Math.random() * 900) + 1900,
            accuracyRate: parseFloat((Math.random() * 2 + 97).toFixed(1)),
            efficiency: Math.floor(Math.random() * 10) + 90,
            dailyDetails: []
        };

        // 生成每日明细
        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            // 只生成当前日期之前的数据
            if (this.currentMonth === this.currentDate.getMonth() + 1 && day > this.currentDate.getDate()) {
                break;
            }

            mockPerformance.dailyDetails.push({
                date: `${this.currentYear}-${this.currentMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
                scans: Math.floor(Math.random() * 50) + 20,
                sorted: Math.floor(Math.random() * 50) + 18,
                accuracy: (Math.random() * 5 + 95).toFixed(1),
                completionRate: (Math.random() * 10 + 90).toFixed(1),
                score: Math.floor(Math.random() * 10) + 90
            });
        }

        localStorage.setItem(performanceKey, JSON.stringify(mockPerformance));
        console.log('月度绩效数据生成完成:', mockPerformance);
    }

    // 生成今日扫描记录
    generateTodayScans() {
        const scansKey = `sorterScans_${this.today}`;
        
        const mockScans = [];
        const scanCount = Math.floor(Math.random() * 20) + 30;
        
        // 模拟不同时间段的扫描量
        const timeSlots = [
            { start: 8, end: 10, count: Math.floor(scanCount * 0.2) },
            { start: 10, end: 12, count: Math.floor(scanCount * 0.3) },
            { start: 14, end: 16, count: Math.floor(scanCount * 0.3) },
            { start: 16, end: 18, count: Math.floor(scanCount * 0.2) }
        ];
        
        let id = 1;
        timeSlots.forEach(slot => {
            for (let i = 0; i < slot.count; i++) {
                const scanTime = new Date();
                scanTime.setHours(slot.start + Math.floor(Math.random() * (slot.end - slot.start)));
                scanTime.setMinutes(Math.floor(Math.random() * 60));
                
                const status = Math.random() > 0.05 ? 'success' : 'error';
                const errorMessages = [
                    '包裹信息不匹配',
                    '条形码无法识别',
                    '重量异常',
                    '目的地信息缺失',
                    '重复扫描'
                ];
                
                mockScans.push({
                    id: id++,
                    waybillNumber: `WB${100000000000000 + Math.floor(Math.random() * 900000000000000)}`,
                    orderId: `HL${['BJ', 'SH', 'GZ', 'SZ', 'HZ', 'NJ', 'CD', 'WH'][Math.floor(Math.random() * 8)]}${167373120000000000 + Math.floor(Math.random() * 100000000000000)}`,
                    scanTime: scanTime.toLocaleString('zh-CN'),
                    scanType: 'sorting_scan',
                    status: status,
                    errorMessage: status === 'error' ? errorMessages[Math.floor(Math.random() * errorMessages.length)] : ''
                });
            }
        });
        
        localStorage.setItem(scansKey, JSON.stringify(mockScans));
        console.log('今日扫描记录生成完成:', mockScans.length, '条记录');
    }

    // 生成今日分拣项目
    generateTodaySortingItems() {
        const sortingKey = `sorterSortingItems_${this.today}`;
        
        const mockItems = [];
        const itemCount = Math.floor(Math.random() * 15) + 25;
        
        // 更多目的地选项
        const destinations = ['北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '武汉', '西安', '重庆', '天津', '苏州', '郑州', '长沙', '青岛'];
        
        // 更多包裹类型
        const packageTypes = [
            '电子设备', '服装', '书籍', '食品', '日用品',
            '化妆品', '医疗器械', '办公用品', '家居用品', '体育用品'
        ];
        
        // 更多分拣备注
        const sortingRemarks = [
            '易碎物品，小心轻放',
            '贵重物品，单独存放',
            '液体物品，防漏处理',
            '大件物品，注意尺寸',
            '加急件，优先处理',
            ''
        ];
        
        // 目的地与分拣区域映射
        const locationMap = {
            '北京': 'A区', '天津': 'A区',
            '上海': 'B区', '南京': 'B区', '苏州': 'B区',
            '广州': 'C区', '深圳': 'C区',
            '杭州': 'E区',
            '成都': 'G区', '重庆': 'G区',
            '武汉': 'H区', '长沙': 'H区',
            '西安': 'I区',
            '郑州': 'J区',
            '青岛': 'K区'
        };
        
        for (let i = 0; i < itemCount; i++) {
            const status = Math.random() > 0.3 ? 'pending' : 'sorted';
            const destination = destinations[Math.floor(Math.random() * destinations.length)];
            const packageType = packageTypes[Math.floor(Math.random() * packageTypes.length)];
            const weight = (Math.random() * 10 + 0.5).toFixed(1);
            
            const item = {
                id: i + 1,
                waybillNumber: `WB${100000000000000 + Math.floor(Math.random() * 900000000000000)}`,
                orderId: `HL${['BJ', 'SH', 'GZ', 'SZ', 'HZ', 'NJ', 'CD', 'WH', 'XA', 'CQ'][Math.floor(Math.random() * 10)]}${167373120000000000 + Math.floor(Math.random() * 100000000000000)}`,
                destination: destination,
                packageInfo: `${packageType}，${weight}kg`,
                status: status
            };
            
            if (status === 'sorted') {
                item.sortingLocation = locationMap[destination] || '其他区';
                item.sortingRemark = sortingRemarks[Math.floor(Math.random() * sortingRemarks.length)];
                
                // 模拟不同时间段的分拣时间
                const sortTime = new Date();
                sortTime.setHours(8 + Math.floor(Math.random() * 10));
                sortTime.setMinutes(Math.floor(Math.random() * 60));
                item.sortingTime = sortTime.toLocaleString('zh-CN');
            }
            
            mockItems.push(item);
        }
        
        localStorage.setItem(sortingKey, JSON.stringify(mockItems));
        console.log('今日分拣项目生成完成:', mockItems.length, '条记录');
    }

    // 生成月度任务数据
    generateMonthlyTasks() {
        const tasksKey = `sorterTasks_${this.currentYear}_${this.currentMonth}`;
        
        const mockTasks = [];
        const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
        
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(this.currentYear, this.currentMonth - 1, day);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            
            // 工作日生成1-3个任务
            if (!isWeekend) {
                const taskCount = Math.floor(Math.random() * 3) + 1;
                for (let i = 0; i < taskCount; i++) {
                    mockTasks.push({
                        id: `${day}_${i}`,
                        date: date.toISOString().split('T')[0],
                        title: `分拣任务 ${day}-${i + 1}`,
                        priority: Math.random() > 0.7 ? 'high' : Math.random() > 0.5 ? 'medium' : 'low',
                        startTime: `0${Math.floor(Math.random() * 8) + 8}:00`.slice(-5),
                        endTime: `1${Math.floor(Math.random() * 2) + 7}:00`,
                        location: ['上海分拣中心A区', '上海分拣中心B区', '上海分拣中心C区'][Math.floor(Math.random() * 3)],
                        status: Math.random() > 0.6 ? 'completed' : Math.random() > 0.5 ? 'in-progress' : 'pending'
                    });
                }
            }
        }
        
        localStorage.setItem(tasksKey, JSON.stringify(mockTasks));
        console.log('月度任务数据生成完成:', mockTasks.length, '条任务');
    }

    // 生成月度排班数据
    generateMonthlySchedule() {
        const scheduleKey = `sorterSchedule_${this.currentYear}_${this.currentMonth}`;
        
        const mockSchedule = [];
        const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
        
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(this.currentYear, this.currentMonth - 1, day);
            const dayOfWeek = date.getDay();
            let shift = 'off';
            let status = 'off';
            
            // 周一到周五安排工作
            if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                shift = Math.random() > 0.5 ? '早班' : '晚班';
                status = 'working';
            }
            
            mockSchedule.push({
                date: date.toISOString().split('T')[0],
                day: day,
                dayOfWeek: dayOfWeek,
                shift: shift,
                status: status
            });
        }
        
        localStorage.setItem(scheduleKey, JSON.stringify(mockSchedule));
        console.log('月度排班数据生成完成:', mockSchedule.length, '天排班');
    }

    // 生成今日打卡记录
    generateTodayClockRecords() {
        const clockKey = `sorterClock_${this.today}`;
        
        const mockRecords = [];
        
        // 上班打卡
        const clockInTime = new Date();
        clockInTime.setHours(8 + Math.floor(Math.random() * 2));
        clockInTime.setMinutes(Math.floor(Math.random() * 60));
        
        mockRecords.push({
            id: Date.now() - 1000000,
            type: 'in',
            time: clockInTime.toLocaleString('zh-CN'),
            timestamp: clockInTime.getTime(),
            username: '分拣员001'
        });
        
        // 随机生成下班打卡（如果当前时间大于16点）
        if (this.currentDate.getHours() >= 16) {
            const clockOutTime = new Date();
            clockOutTime.setHours(16 + Math.floor(Math.random() * 4));
            clockOutTime.setMinutes(Math.floor(Math.random() * 60));
            
            mockRecords.push({
                id: Date.now(),
                type: 'out',
                time: clockOutTime.toLocaleString('zh-CN'),
                timestamp: clockOutTime.getTime(),
                username: '分拣员001'
            });
        }
        
        localStorage.setItem(clockKey, JSON.stringify(mockRecords));
        console.log('今日打卡记录生成完成:', mockRecords);
    }

    // 生成历史打卡记录（过去7天）
    generateHistoricalClockRecords() {
        for (let i = 1; i <= 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const clockKey = `sorterClock_${dateStr}`;
            
            // 只在工作日生成打卡记录
            if (date.getDay() >= 1 && date.getDay() <= 5) {
                const mockRecords = [];
                
                // 上班打卡
                const clockInTime = new Date(date);
                clockInTime.setHours(8 + Math.floor(Math.random() * 2));
                clockInTime.setMinutes(Math.floor(Math.random() * 60));
                
                mockRecords.push({
                    id: Date.now() - i * 1000000,
                    type: 'in',
                    time: clockInTime.toLocaleString('zh-CN'),
                    timestamp: clockInTime.getTime(),
                    username: '分拣员001'
                });
                
                // 下班打卡
                const clockOutTime = new Date(date);
                clockOutTime.setHours(16 + Math.floor(Math.random() * 4));
                clockOutTime.setMinutes(Math.floor(Math.random() * 60));
                
                mockRecords.push({
                    id: Date.now() - i * 1000000 + 1000,
                    type: 'out',
                    time: clockOutTime.toLocaleString('zh-CN'),
                    timestamp: clockOutTime.getTime(),
                    username: '分拣员001'
                });
                
                localStorage.setItem(clockKey, JSON.stringify(mockRecords));
                console.log(`${dateStr} 打卡记录生成完成`);
            }
        }
    }

    // 生成所有示例数据
    generateAllMockData() {
        console.log('开始生成分拣员角色示例数据...');
        
        this.generateTodayStats();
        this.generateMonthlyPerformance();
        this.generateTodayScans();
        this.generateTodaySortingItems();
        this.generateMonthlyTasks();
        this.generateMonthlySchedule();
        this.generateTodayClockRecords();
        this.generateHistoricalClockRecords();
        
        console.log('所有示例数据生成完成！');
    }
}

// 初始化并生成数据
if (typeof window !== 'undefined') {
    window.SorterMockDataGenerator = SorterMockDataGenerator;
    
    // 当页面加载时自动生成数据
    window.addEventListener('DOMContentLoaded', () => {
        // 强制生成数据，确保数据存在
        const generator = new SorterMockDataGenerator();
        generator.generateAllMockData();
        console.log('分拣员示例数据已强制生成');
    });
}

// 导出模块（用于其他脚本调用）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SorterMockDataGenerator;
}
