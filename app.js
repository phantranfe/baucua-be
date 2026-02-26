const express = require('express');
const http = require('http');
const {
    Server
} = require('socket.io');
const {
    ITEMS
} = require('./constants');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = {};

const checkReadyStatus = (roomId) => {
    const room = rooms[roomId];
    if (room) {
        const allReady = room.users.length > 0 ? room.users.every(u => u.isReady) : true;

        io.to(roomId).emit('update_ready_status', {
            allReady: allReady,
            users: room.users
        });
    }
};

io.on('connection', (socket) => {

    socket.on('join_room', ({
        roomId,
        userName,
        password
    }) => {
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                password: password,
                dealer: socket.id,
                users: [],
                drawnItems: [],
                items: ITEMS
            };
        } else {
            if (rooms[roomId].password !== password) {
                return socket.emit('join_error', 'Mật khẩu phòng không chính xác.');
            }
            const nameExists = rooms[roomId].users.some(u =>
                u.name.trim().toLowerCase() === userName.trim().toLowerCase()
            );
            if (nameExists) {
                return socket.emit('join_error', 'Tên này đã có người sử dụng.');
            }
            if (rooms[roomId].drawnItems?.length > 0) {
                return socket.emit('join_error', 'Phòng này đã bắt đầu chơi.');
            }
        }

        const room = rooms[roomId];
        room.users.push({
            id: socket.id,
            name: userName,
            isReady: false
        });
        socket.join(roomId);

        io.in(roomId).emit('room_state', room);
        checkReadyStatus(roomId);
    });

    socket.on('bet', ({
        roomId,
        userName,
        items
    }) => {
        const room = rooms[roomId];
        if (room && room.drawnItems.length === 0) {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const chosenItem = room.items.find(t => t.id === item.id);
                if (chosenItem) {
                    if (chosenItem.users) {
                        chosenItem.users.push({
                            userName,
                            id: socket.id,
                            amount: item.amount
                        });
                    } else {
                        chosenItem.users = [{
                            userName,
                            id: socket.id,
                            amount: item.amount
                        }];
                    }
                    io.in(roomId).emit('update_items', room.items);
                }
            }
        } else {
            socket.emit('error_msg', 'Không thể chơi lúc này.');
        }
    });

    socket.on('draw_items', ({
        roomId,
        drawnItems
    }) => {
        const drawnItemIds = drawnItems.map((item) => item.id);
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            const players = room.users.filter(u => u.id !== room.dealer);
            const allReady = players.length > 0 ? players.every(u => u.isReady) : true;

            if (!allReady) return socket.emit('error_msg', 'Chưa đủ người sẵn sàng.');

            const result = {};

            for (let i = 0; i < room.items.length; i++) {
                const roomItem = room.items[i];
                if (drawnItemIds.includes(roomItem.id)) {
                    
                } else {
                    
                }
            }

            // room.drawnItems.push(number);
            // io.in(roomId).emit('new_number', {
            //     number: number,
            //     history: room.drawnItems
            // });
        }
    });

    socket.on('change_dealer', ({
        roomId,
        targetUserId
    }) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.dealer = targetUserId;
            checkReadyStatus(roomId);
            io.in(roomId).emit('room_state', room);
        }
    });

    socket.on('ready', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            const user = room.users.find(u => u.id === socket.id);
            if (user) {
                user.isReady = true;
                checkReadyStatus(roomId);
            }
        }
    });

    socket.on('claim_win', ({roomId, userName}) => {
        const room = rooms[roomId];
        if (room) {
            io.to(roomId).emit('win', userName);
        }
    });

    socket.on('reset_game', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.drawnItems = [];
            room.users.forEach(u => u.isReady = false);

            io.to(roomId).emit('game_reset', room);
            checkReadyStatus(roomId);
        }
    });

    socket.on('disconnect', () => {
        for (const rid in rooms) {
            const r = rooms[rid];
            const idx = r.users.findIndex(u => u.id === socket.id);
            if (idx !== -1) {
                r.users.splice(idx, 1);
                r.items.forEach(t => {
                    if (t.owner === socket.id) {
                        t.owner = null;
                        t.userName = null;
                    }
                });

                if (r.users.length === 0) {
                    delete rooms[rid];
                } else {
                    if (r.dealer === socket.id) r.dealer = r.users[0].id;
                    io.in(rid).emit('room_state', r);
                    checkReadyStatus(rid);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
