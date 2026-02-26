const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { ITEMS } = require('./constants');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Lưu trữ trạng thái các phòng
const rooms = {};

/**
 * Hàm kiểm tra trạng thái sẵn sàng của tất cả người chơi (trừ Dealer)
 */
const checkReadyStatus = (roomId) => {
    const room = rooms[roomId];
    if (room) {
        const players = room.users.filter(u => u.id !== room.dealer);
        const allReady = players.length > 0 ? players.every(u => u.isReady) : true;

        io.to(roomId).emit('update_ready_status', {
            allReady: allReady,
            users: room.users
        });
    }
};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join_room', ({ roomId, userName, password }) => {
        if (!rooms[roomId]) {
            // Khởi tạo phòng mới với bản sao sâu (Deep Copy) của ITEMS
            rooms[roomId] = {
                id: roomId,
                password: password,
                dealer: socket.id,
                users: [],
                drawnItems: [],
                // Clone ITEMS để tránh thay đổi dữ liệu gốc trong constants.js
                items: ITEMS.map(item => ({ ...item, allBets: [] }))
            };
        } else {
            const room = rooms[roomId];
            if (room.password !== password) {
                return socket.emit('join_error', 'Mật khẩu phòng không chính xác.');
            }
            const nameExists = room.users.some(u =>
                u.name.trim().toLowerCase() === userName.trim().toLowerCase()
            );
            if (nameExists) {
                return socket.emit('join_error', 'Tên này đã có người sử dụng.');
            }
            if (room.drawnItems && room.drawnItems.length > 0) {
                return socket.emit('join_error', 'Phòng này đã bắt đầu chơi.');
            }
        }

        const room = rooms[roomId];
        room.users.push({
            id: socket.id,
            name: userName,
            isReady: false
        });

        // Lưu thông tin roomId vào socket để xử lý disconnect nhanh hơn
        socket.roomId = roomId;
        socket.join(roomId);

        io.in(roomId).emit('room_state', room);
        checkReadyStatus(roomId);
    });

    socket.on('bet', ({ roomId, userName, items }) => {
        const room = rooms[roomId];
        // Chỉ cho phép đặt cược khi chưa ra kết quả
        if (room && room.drawnItems.length === 0) {
            items.forEach(betItem => {
                const roomItem = room.items.find(t => t.id === betItem.id);
                if (roomItem && betItem.amount > 0) {
                    if (!roomItem.allBets) roomItem.allBets = [];
                    roomItem.allBets.push({
                        userName,
                        amount: Number(betItem.amount)
                    });
                }
            });
            io.in(roomId).emit('room_state', room);
        } else {
            socket.emit('error_msg', 'Không thể đặt cược lúc này.');
        }
    });

    socket.on('draw_items', ({ roomId, drawnItems }) => {
        const room = rooms[roomId];
        if (!room || socket.id !== room.dealer) return;

        const players = room.users.filter(u => u.id !== room.dealer);
        const allReady = players.length > 0 ? players.every(u => u.isReady) : true;

        if (!allReady) {
            return socket.emit('error_msg', 'Chưa đủ người sẵn sàng.');
        }

        // Cập nhật kết quả vào phòng
        room.drawnItems = drawnItems;
        const drawnIds = drawnItems.map(item => item.id);
        const result = {};

        // Tính toán thắng thua
        room.items.forEach(roomItem => {
            if (!roomItem.allBets) return;

            // Đếm số lần item này xuất hiện trong kết quả (x1, x2, x3)
            const count = drawnIds.filter(id => id === roomItem.id).length;

            roomItem.allBets.forEach(bet => {
                if (!result[bet.userName]) result[bet.userName] = 0;
                
                if (count > 0) {
                    // Thắng: Số tiền thắng = Tiền cược * số lần xuất hiện
                    result[bet.userName] += (bet.amount * count);
                } else {
                    // Thua: Trừ tiền cược
                    result[bet.userName] -= bet.amount;
                }
            });
        });

        io.in(roomId).emit('result', { 
            result, 
            drawnItems: room.drawnItems 
        });
    });

    socket.on('change_dealer', ({ roomId, targetUserId }) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.dealer = targetUserId;
            // Reset sẵn sàng khi đổi cái
            room.users.forEach(u => u.isReady = false);
            io.in(roomId).emit('room_state', room);
            checkReadyStatus(roomId);
        }
    });

    socket.on('reset_game', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            // Reset toàn bộ trạng thái để sang ván mới
            room.drawnItems = [];
            room.users.forEach(u => u.isReady = false);
            room.items.forEach(item => {
                item.allBets = []; // Xóa hết cược cũ
            });

            io.in(roomId).emit('game_reset', room);
            checkReadyStatus(roomId);
        }
    });

    socket.on('toggle_ready', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            const user = room.users.find(u => u.id === socket.id);
            if (user && socket.id !== room.dealer) {
                user.isReady = !user.isReady;
                checkReadyStatus(roomId);
            }
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        const room = rooms[roomId];

        if (room) {
            const idx = room.users.findIndex(u => u.id === socket.id);
            if (idx !== -1) {
                room.users.splice(idx, 1);
                
                // Nếu phòng trống thì xóa phòng
                if (room.users.length === 0) {
                    delete rooms[roomId];
                } else {
                    // Nếu Dealer thoát, chuyển Dealer cho người tiếp theo
                    if (room.dealer === socket.id) {
                        room.dealer = room.users[0].id;
                    }
                    io.in(roomId).emit('room_state', room);
                    checkReadyStatus(roomId);
                }
            }
        }
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
