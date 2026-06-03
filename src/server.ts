import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

// temporary in-memory storage
const games: Record<string, any> = {};

io.on("connection", (socket) => {
    console.log("user connected:", socket.id);

    socket.on("join_game", (gameId) => {
        socket.join(gameId);

        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                players: [],
                state: "waiting"
            };
        }

        games[gameId].players.push(socket.id);

        io.to(gameId).emit("game_state", games[gameId]);
    });

    socket.on("disconnect", () => {
        console.log("user disconnected");
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});