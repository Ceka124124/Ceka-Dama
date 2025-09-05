const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Static dosyalar için
app.use(express.static('public'));
app.use(express.json());

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Kullanıcı bilgisi alma API
app.post('/api/user', async (req, res) => {
  try {
    const { id } = req.body;
    const response = await axios.get(`https://pay.starmakerstudios.com/rapid/user?category=6&id=${id}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Kullanıcı bilgisi alınamadı' });
  }
});

// Oyun durumu
let rooms = {};
let users = {};

class CheckersRoom {
  constructor(roomId, creator) {
    this.id = roomId;
    this.creator = creator;
    this.players = [creator];
    this.game = null;
    this.chat = [];
    this.reactions = [];
    this.isGameStarted = false;
  }

  addPlayer(player) {
    if (this.players.length < 2) {
      this.players.push(player);
      if (this.players.length === 2) {
        this.startGame();
      }
      return true;
    }
    return false;
  }

  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
    if (this.isGameStarted) {
      this.isGameStarted = false;
      this.game = null;
    }
  }

  startGame() {
    this.game = new CheckersGame(this.players[0], this.players[1]);
    this.isGameStarted = true;
  }

  addChatMessage(playerId, message) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      this.chat.push({
        id: Date.now(),
        playerId,
        playerName: player.name,
        playerAvatar: player.avatar,
        playerLevel: player.level,
        message,
        timestamp: new Date()
      });
    }
  }

  addReaction(playerId, reaction) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      const reactionData = {
        id: Date.now(),
        playerId,
        playerName: player.name,
        playerAvatar: player.avatar,
        reaction,
        timestamp: Date.now()
      };
      this.reactions.push(reactionData);
      
      // 5 saniye sonra reaksiyonu kaldır
      setTimeout(() => {
        this.reactions = this.reactions.filter(r => r.id !== reactionData.id);
      }, 5000);
      
      return reactionData;
    }
    return null;
  }
}

class CheckersGame {
  constructor(player1, player2) {
    this.players = {
      red: player1,
      black: player2
    };
    this.currentTurn = 'red';
    this.board = this.initializeBoard();
    this.gameOver = false;
    this.winner = null;
    this.moveHistory = [];
  }

  initializeBoard() {
    const board = Array(8).fill(null).map(() => Array(8).fill(null));
    
    // Siyah taşlar (üst)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 8; col++) {
        if ((row + col) % 2 === 1) {
          board[row][col] = { color: 'black', isKing: false };
        }
      }
    }
    
    // Kırmızı taşlar (alt)
    for (let row = 5; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if ((row + col) % 2 === 1) {
          board[row][col] = { color: 'red', isKing: false };
        }
      }
    }
    
    return board;
  }

  isValidMove(fromRow, fromCol, toRow, toCol, playerColor) {
    const piece = this.board[fromRow][fromCol];
    if (!piece || piece.color !== playerColor) return false;
    if (this.board[toRow][toCol] !== null) return false;

    const rowDiff = toRow - fromRow;
    const colDiff = Math.abs(toCol - fromCol);

    // Normal hareket
    if (Math.abs(rowDiff) === 1 && colDiff === 1) {
      if (!piece.isKing) {
        return (playerColor === 'red' && rowDiff === -1) || 
               (playerColor === 'black' && rowDiff === 1);
      }
      return true;
    }

    // Atlama hareketi
    if (Math.abs(rowDiff) === 2 && colDiff === 2) {
      const middleRow = fromRow + rowDiff / 2;
      const middleCol = fromCol + (toCol - fromCol) / 2;
      const middlePiece = this.board[middleRow][middleCol];
      
      if (middlePiece && middlePiece.color !== playerColor) {
        if (!piece.isKing) {
          return (playerColor === 'red' && rowDiff === -2) || 
                 (playerColor === 'black' && rowDiff === 2);
        }
        return true;
      }
    }

    return false;
  }

  makeMove(fromRow, fromCol, toRow, toCol, playerColor) {
    if (!this.isValidMove(fromRow, fromCol, toRow, toCol, playerColor)) {
      return false;
    }

    const piece = this.board[fromRow][fromCol];
    this.board[toRow][toCol] = piece;
    this.board[fromRow][fromCol] = null;

    let capturedPiece = null;

    // Atlama varsa orta taşı kaldır
    if (Math.abs(toRow - fromRow) === 2) {
      const middleRow = fromRow + (toRow - fromRow) / 2;
      const middleCol = fromCol + (toCol - fromCol) / 2;
      capturedPiece = this.board[middleRow][middleCol];
      this.board[middleRow][middleCol] = null;
    }

    // Kral yap
    if ((piece.color === 'red' && toRow === 0) || 
        (piece.color === 'black' && toRow === 7)) {
      piece.isKing = true;
    }

    // Hamle geçmişini kaydet
    this.moveHistory.push({
      from: { row: fromRow, col: fromCol },
      to: { row: toRow, col: toCol },
      player: playerColor,
      captured: capturedPiece,
      becameKing: piece.isKing && ((piece.color === 'red' && toRow === 0) || (piece.color === 'black' && toRow === 7))
    });

    // Sırayı değiştir
    this.currentTurn = this.currentTurn === 'red' ? 'black' : 'red';

    // Oyun bitti mi kontrol et
    this.checkGameEnd();

    return true;
  }

  checkGameEnd() {
    let redPieces = 0;
    let blackPieces = 0;
    
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = this.board[row][col];
        if (piece) {
          if (piece.color === 'red') redPieces++;
          else blackPieces++;
        }
      }
    }

    if (redPieces === 0) {
      this.gameOver = true;
      this.winner = 'black';
    } else if (blackPieces === 0) {
      this.gameOver = true;
      this.winner = 'red';
    }
  }
}

io.on('connection', (socket) => {
  console.log('Yeni oyuncu bağlandı:', socket.id);

  socket.on('userLogin', (userData) => {
    users[socket.id] = {
      id: socket.id,
      userId: userData.id,
      name: userData.stage_name,
      avatar: userData.profile_image,
      level: userData.level,
      country: userData.country
    };
    
    socket.emit('loginSuccess', users[socket.id]);
  });

  socket.on('createRoom', () => {
    const user = users[socket.id];
    if (!user) return;

    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    const room = new CheckersRoom(roomId, user);
    rooms[roomId] = room;
    
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, room: room });
  });

  socket.on('joinRoom', (roomId) => {
    const user = users[socket.id];
    const room = rooms[roomId];
    
    if (!user || !room) {
      socket.emit('error', 'Kullanıcı veya oda bulunamadı!');
      return;
    }

    if (room.addPlayer(user)) {
      socket.join(roomId);
      io.to(roomId).emit('playerJoined', { 
        room: room,
        newPlayer: user 
      });

      if (room.isGameStarted) {
        io.to(roomId).emit('gameStarted', {
          game: room.game,
          room: room
        });
      }
    } else {
      socket.emit('error', 'Oda dolu!');
    }
  });

  socket.on('makeMove', (data) => {
    const { roomId, fromRow, fromCol, toRow, toCol } = data;
    const room = rooms[roomId];
    const user = users[socket.id];
    
    if (room && room.game && user) {
      const playerColor = room.game.players.red.id === socket.id ? 'red' : 'black';
      
      if (room.game.currentTurn === playerColor) {
        if (room.game.makeMove(fromRow, fromCol, toRow, toCol, playerColor)) {
          io.to(roomId).emit('moveMade', {
            game: room.game,
            lastMove: room.game.moveHistory[room.game.moveHistory.length - 1]
          });

          if (room.game.gameOver) {
            io.to(roomId).emit('gameOver', {
              winner: room.game.winner,
              winnerData: room.game.players[room.game.winner]
            });
          }
        } else {
          socket.emit('invalidMove', 'Geçersiz hamle!');
        }
      }
    }
  });

  socket.on('sendMessage', (data) => {
    const { roomId, message } = data;
    const room = rooms[roomId];
    
    if (room && message.trim()) {
      room.addChatMessage(socket.id, message);
      io.to(roomId).emit('newMessage', room.chat[room.chat.length - 1]);
    }
  });

  socket.on('sendReaction', (data) => {
    const { roomId, reaction } = data;
    const room = rooms[roomId];
    
    if (room) {
      const reactionData = room.addReaction(socket.id, reaction);
      if (reactionData) {
        io.to(roomId).emit('newReaction', reactionData);
      }
    }
  });

  socket.on('getRooms', () => {
    const availableRooms = Object.values(rooms).filter(room => 
      room.players.length < 2 && !room.isGameStarted
    ).map(room => ({
      id: room.id,
      creator: room.creator.name,
      playerCount: room.players.length
    }));
    
    socket.emit('roomsList', availableRooms);
  });

  socket.on('disconnect', () => {
    console.log('Oyuncu ayrıldı:', socket.id);
    
    // Kullanıcıyı kaldır
    delete users[socket.id];
    
    // Odalardan çık
    for (let roomId in rooms) {
      const room = rooms[roomId];
      const wasInRoom = room.players.some(p => p.id === socket.id);
      
      if (wasInRoom) {
        room.removePlayer(socket.id);
        
        if (room.players.length === 0) {
          delete rooms[roomId];
        } else {
          io.to(roomId).emit('playerLeft', {
            room: room,
            leftPlayerId: socket.id
          });
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server çalışıyor: http://localhost:${PORT}`);
  console.log('Gerekli paketler: npm install express socket.io axios');
});
