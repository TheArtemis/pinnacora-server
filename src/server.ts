import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import type { DecodedIdToken } from "firebase-admin/auth";
import cors from "cors";
import { verifyFirebaseToken } from "./auth/firebase";
import usersRouter from "./routes/users";

const app = express();

const localClientUrls = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174"
];
const configuredClientUrls = process.env.CLIENT_URL
    ?.split(",")
    .map((url) => url.trim())
    .filter(Boolean) ?? [];
const corsOrigins = [...new Set([...configuredClientUrls, ...localClientUrls])];

app.use(cors({ origin: corsOrigins }));
app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

app.use("/users", usersRouter);

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: corsOrigins
    }
});

// temporary in-memory storage
type GameRoom = {
    id: string;
    players: string[];
    state: "waiting" | "playing";
};

const games: Record<string, GameRoom> = {};

function getSocketToken(socket: Socket) {
    const token = socket.handshake.auth.token;
    return typeof token === "string" && token.trim().length > 0 ? token : undefined;
}

function getSocketUser(socket: Socket) {
    return (socket.data as { firebaseUser: DecodedIdToken }).firebaseUser;
}

io.use(async (socket, next) => {
    const token = getSocketToken(socket);

    if (!token) {
        next(new Error("Missing Firebase auth token."));
        return;
    }

    try {
        (socket.data as { firebaseUser?: DecodedIdToken }).firebaseUser =
            await verifyFirebaseToken(token);
        next();
    } catch {
        next(new Error("Invalid or expired Firebase token."));
    }
});

io.on("connection", (socket) => {
    const firebaseUser = getSocketUser(socket);

    console.log("user connected:", firebaseUser.uid);

    socket.on("join_game", (gameId: string) => {
        socket.join(gameId);

        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                players: [],
                state: "waiting"
            };
        }

        if (!games[gameId].players.includes(firebaseUser.uid)) {
            games[gameId].players.push(firebaseUser.uid);
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