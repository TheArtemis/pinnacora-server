import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import type { DecodedIdToken } from "firebase-admin/auth";
import cors from "cors";
import { GameStatus, Prisma } from "./generated/prisma/client";
import { verifyFirebaseToken } from "./auth/firebase";
import { prisma } from "./db";
import {
    discardCard,
    drawCard,
    maybeStartGame,
    restoreGameState,
    serializeGameStateForPlayer,
    syncPresence,
    type GameParticipant,
    type PersistedGameState,
} from "./game/engine";
import tournamentsRouter from "./routes/tournaments";
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
app.use("/tournaments", tournamentsRouter);

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: corsOrigins
    }
});

const gameConnections = new Map<string, Map<string, number>>();

function getSocketToken(socket: Socket) {
    const token = socket.handshake.auth.token;
    return typeof token === "string" && token.trim().length > 0 ? token : undefined;
}

function getSocketUser(socket: Socket) {
    return (socket.data as { firebaseUser: DecodedIdToken }).firebaseUser;
}

function getSocketGameData(socket: Socket) {
    return socket.data as {
        appUserId?: string;
        roomCode?: string;
    };
}

function getGameIdFromPayload(payload: unknown) {
    if (typeof payload === "string") {
        return payload.trim();
    }

    if (
        typeof payload === "object" &&
        payload !== null &&
        "gameId" in payload &&
        typeof payload.gameId === "string"
    ) {
        return payload.gameId.trim();
    }

    return "";
}

function getCardIdFromPayload(payload: unknown) {
    if (
        typeof payload === "object" &&
        payload !== null &&
        "cardId" in payload &&
        typeof payload.cardId === "string"
    ) {
        return payload.cardId.trim();
    }

    return "";
}

function playerName(user: { displayName: string | null; email: string | null }) {
    return user.displayName ?? user.email ?? "Player";
}

function toGameParticipants(
    participants: Array<{
        userId: string;
        user: { displayName: string | null; email: string | null };
    }>
): GameParticipant[] {
    return participants.map((participant) => ({
        id: participant.userId,
        name: playerName(participant.user),
    }));
}

function incrementConnection(roomCode: string, userId: string) {
    const roomConnections = gameConnections.get(roomCode) ?? new Map<string, number>();
    roomConnections.set(userId, (roomConnections.get(userId) ?? 0) + 1);
    gameConnections.set(roomCode, roomConnections);
}

function decrementConnection(roomCode: string, userId: string) {
    const roomConnections = gameConnections.get(roomCode);

    if (!roomConnections) {
        return;
    }

    const nextCount = (roomConnections.get(userId) ?? 0) - 1;

    if (nextCount > 0) {
        roomConnections.set(userId, nextCount);
    } else {
        roomConnections.delete(userId);
    }

    if (roomConnections.size === 0) {
        gameConnections.delete(roomCode);
    }
}

function getConnectedPlayerIds(roomCode: string) {
    return new Set(gameConnections.get(roomCode)?.keys() ?? []);
}

function gameStatusFromState(state: PersistedGameState) {
    if (state.status === "waiting") {
        return GameStatus.WAITING;
    }

    if (state.status === "finished") {
        return GameStatus.FINISHED;
    }

    return GameStatus.PLAYING;
}

async function findPersistentGame(roomCode: string) {
    return prisma.game.findUnique({
        where: { roomCode },
        include: {
            tournament: {
                include: {
                    participants: {
                        include: { user: true },
                        orderBy: { joinedAt: "asc" },
                    },
                },
            },
        },
    });
}

async function persistGameState(gameId: string, state: PersistedGameState) {
    await prisma.game.update({
        where: { id: gameId },
        data: {
            status: gameStatusFromState(state),
            state: state as unknown as Prisma.InputJsonValue,
        },
    });
}

async function emitGameState(roomCode: string, state: PersistedGameState) {
    const sockets = await io.in(roomCode).fetchSockets();

    for (const roomSocket of sockets) {
        const viewerPlayerId = (roomSocket.data as { appUserId?: string }).appUserId;
        roomSocket.emit("game_state", serializeGameStateForPlayer(state, viewerPlayerId));
    }
}

async function loadGameState(roomCode: string) {
    const persistentGame = await findPersistentGame(roomCode);

    if (!persistentGame) {
        return { error: "Game room was not found." };
    }

    if (persistentGame.status === GameStatus.FINISHED) {
        return { error: "This game has already finished." };
    }

    const participants = toGameParticipants(persistentGame.tournament.participants);

    if (participants.length !== 2) {
        return { error: "A game needs exactly two tournament players." };
    }

    const state = maybeStartGame(
        syncPresence(
            restoreGameState(persistentGame.state, persistentGame.roomCode, participants),
            getConnectedPlayerIds(roomCode),
        ),
    );

    return { persistentGame, state };
}

async function handleDrawCard(socket: Socket) {
    const { appUserId, roomCode } = getSocketGameData(socket);

    if (!appUserId || !roomCode) {
        socket.emit("game_error", { error: "Join the game before taking a turn." });
        return;
    }

    const loaded = await loadGameState(roomCode);

    if ("error" in loaded) {
        socket.emit("game_error", { error: loaded.error });
        return;
    }

    const result = drawCard(loaded.state, appUserId);

    if ("error" in result) {
        socket.emit("game_error", { error: result.error });
        return;
    }

    await persistGameState(loaded.persistentGame.id, result.state);
    await emitGameState(roomCode, result.state);
}

async function handleDiscardCard(socket: Socket, payload: unknown) {
    const { appUserId, roomCode } = getSocketGameData(socket);
    const cardId = getCardIdFromPayload(payload);

    if (!appUserId || !roomCode) {
        socket.emit("game_error", { error: "Join the game before taking a turn." });
        return;
    }

    if (!cardId) {
        socket.emit("game_error", { error: "Choose a card to discard." });
        return;
    }

    const loaded = await loadGameState(roomCode);

    if ("error" in loaded) {
        socket.emit("game_error", { error: loaded.error });
        return;
    }

    const result = discardCard(loaded.state, appUserId, cardId);

    if ("error" in result) {
        socket.emit("game_error", { error: result.error });
        return;
    }

    await persistGameState(loaded.persistentGame.id, result.state);
    await emitGameState(roomCode, result.state);
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

    socket.on("join_game", async (payload: unknown) => {
        const gameId = getGameIdFromPayload(payload);

        if (!gameId) {
            socket.emit("game_error", { error: "Game room code is required." });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { firebaseUid: firebaseUser.uid },
        });

        if (!user) {
            socket.emit("game_error", { error: "User has not been created yet." });
            return;
        }

        const persistentGame = await findPersistentGame(gameId);

        if (!persistentGame) {
            socket.emit("game_error", { error: "Game room was not found." });
            return;
        }

        if (persistentGame.status === GameStatus.FINISHED) {
            socket.emit("game_error", { error: "This game has already finished." });
            return;
        }

        const isParticipant = persistentGame.tournament.participants.some(
            (participant) => participant.userId === user.id,
        );

        if (!isParticipant) {
            socket.emit("game_error", { error: "You are not in this tournament." });
            return;
        }

        if (persistentGame.tournament.participants.length !== 2) {
            socket.emit("game_error", { error: "A game needs exactly two tournament players." });
            return;
        }

        const socketData = getSocketGameData(socket);
        const alreadyJoined = socketData.roomCode === gameId && socketData.appUserId === user.id;

        if (socketData.roomCode && socketData.appUserId && !alreadyJoined) {
            socket.leave(socketData.roomCode);
            decrementConnection(socketData.roomCode, socketData.appUserId);
        }

        socketData.appUserId = user.id;
        socketData.roomCode = gameId;

        if (!alreadyJoined) {
            socket.join(gameId);
            incrementConnection(gameId, user.id);
        }

        const participants = toGameParticipants(persistentGame.tournament.participants);
        const state = maybeStartGame(
            syncPresence(
                restoreGameState(persistentGame.state, persistentGame.roomCode, participants),
                getConnectedPlayerIds(gameId),
            ),
        );

        await persistGameState(persistentGame.id, state);
        await emitGameState(gameId, state);
    });

    socket.on("draw_card", async () => {
        await handleDrawCard(socket);
    });

    socket.on("discard_card", async (payload: unknown) => {
        await handleDiscardCard(socket, payload);
    });

    socket.on("disconnect", async () => {
        const { appUserId, roomCode } = getSocketGameData(socket);

        if (appUserId && roomCode) {
            decrementConnection(roomCode, appUserId);

            const loaded = await loadGameState(roomCode);

            if (!("error" in loaded)) {
                await persistGameState(loaded.persistentGame.id, loaded.state);
                await emitGameState(roomCode, loaded.state);
            }
        }

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