import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import usersRouter from "./routes/users";

const app = express();

const clientUrl = process.env.CLIENT_URL;
const corsOrigin = clientUrl ?? "*";

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

app.use("/users", usersRouter);

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: corsOrigin
    }
});

// temporary in-memory storage
type GameRoom = {
    id: string;
    players: string[];
    state: "waiting" | "playing";
};

const games: Record<string, GameRoom> = {};

io.on("connection", (socket) => {
    console.log("user connected:", socket.id);

    socket.on("join_game", (gameId: string) => {
        socket.join(gameId);

        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                players: [],
                state: "waiting"
            };
        }

        if (!games[gameId].players.includes(socket.id)) {
            games[gameId].players.push(socket.id);
        }

        io.to(gameId).emit("game_state", games[gameId]);
    });

    socket.on("disconnect", () => {
        console.log("user disconnected");
    });
});

app.use(
    (
        err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
    ) => {
        console.error(err);
        res.status(500).json({ error: "Internal server error." });
    }
);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});