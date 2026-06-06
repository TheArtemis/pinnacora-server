import { GameStatus } from "../generated/prisma/client";
import type { Server, Socket } from "socket.io";
import { verifyFirebaseToken } from "../auth/firebase";
import { prisma } from "../db";
import {
    decrementConnection,
    incrementConnection,
} from "./presence";
import {
    discardCard,
    drawCard,
    pickUpDiscardPile,
    putDownMeld,
} from "../game/engine";
import {
    emitGameState,
    findPersistentGame,
    loadGameState,
    persistGameState,
    restorePersistentGameState,
} from "./gameState";
import {
    getCardIdFromPayload,
    getCardIdsFromPayload,
    getDiscardPileCountFromPayload,
    getGameIdFromPayload,
    getSocketGameData,
    getSocketToken,
    getSocketUser,
    setSocketUser,
} from "./socketData";

async function handleDrawCard(io: Server, socket: Socket) {
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
    await emitGameState(io, roomCode, result.state);
}

async function handleDiscardCard(io: Server, socket: Socket, payload: unknown) {
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
    await emitGameState(io, roomCode, result.state);
}

async function handlePickUpDiscardPile(io: Server, socket: Socket, payload: unknown) {
    const { appUserId, roomCode } = getSocketGameData(socket);
    const count = getDiscardPileCountFromPayload(payload);
    const cardIds = getCardIdsFromPayload(payload);

    if (!appUserId || !roomCode) {
        socket.emit("game_error", { error: "Join the game before taking a turn." });
        return;
    }

    if (count === undefined) {
        socket.emit("game_error", { error: "Choose cards from the discard pile to pick up." });
        return;
    }

    const loaded = await loadGameState(roomCode);

    if ("error" in loaded) {
        socket.emit("game_error", { error: loaded.error });
        return;
    }

    const result = pickUpDiscardPile(loaded.state, appUserId, count, cardIds);

    if ("error" in result) {
        socket.emit("game_error", { error: result.error });
        return;
    }

    await persistGameState(loaded.persistentGame.id, result.state);
    await emitGameState(io, roomCode, result.state);
}

async function handlePutDownMeld(io: Server, socket: Socket, payload: unknown) {
    const { appUserId, roomCode } = getSocketGameData(socket);
    const cardIds = getCardIdsFromPayload(payload);

    if (!appUserId || !roomCode) {
        socket.emit("game_error", { error: "Join the game before taking a turn." });
        return;
    }

    if (cardIds.length === 0) {
        socket.emit("game_error", { error: "Choose cards to put down." });
        return;
    }

    const loaded = await loadGameState(roomCode);

    if ("error" in loaded) {
        socket.emit("game_error", { error: loaded.error });
        return;
    }

    const result = putDownMeld(loaded.state, appUserId, cardIds);

    if ("error" in result) {
        socket.emit("game_error", { error: result.error });
        return;
    }

    await persistGameState(loaded.persistentGame.id, result.state);
    await emitGameState(io, roomCode, result.state);
}

async function handleJoinGame(io: Server, socket: Socket, payload: unknown) {
    const firebaseUser = getSocketUser(socket);
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

    const state = restorePersistentGameState(persistentGame);

    if (state) {
        await persistGameState(persistentGame.id, state);
        await emitGameState(io, gameId, state);
    }
}

async function handleDisconnect(io: Server, socket: Socket) {
    const { appUserId, roomCode } = getSocketGameData(socket);

    if (appUserId && roomCode) {
        decrementConnection(roomCode, appUserId);

        const loaded = await loadGameState(roomCode);

        if (!("error" in loaded)) {
            await persistGameState(loaded.persistentGame.id, loaded.state);
            await emitGameState(io, roomCode, loaded.state);
        }
    }

    console.log("user disconnected");
}

export function registerGameSocketHandlers(io: Server) {
    io.use(async (socket, next) => {
        const token = getSocketToken(socket);

        if (!token) {
            next(new Error("Missing Firebase auth token."));
            return;
        }

        try {
            setSocketUser(socket, await verifyFirebaseToken(token));
            next();
        } catch {
            next(new Error("Invalid or expired Firebase token."));
        }
    });

    io.on("connection", (socket) => {
        const firebaseUser = getSocketUser(socket);

        console.log("user connected:", firebaseUser.uid);

        socket.on("join_game", async (payload: unknown) => {
            await handleJoinGame(io, socket, payload);
        });

        socket.on("draw_card", async () => {
            await handleDrawCard(io, socket);
        });

        socket.on("pick_up_discard_pile", async (payload: unknown) => {
            await handlePickUpDiscardPile(io, socket, payload);
        });

        socket.on("put_down_meld", async (payload: unknown) => {
            await handlePutDownMeld(io, socket, payload);
        });

        socket.on("discard_card", async (payload: unknown) => {
            await handleDiscardCard(io, socket, payload);
        });

        socket.on("disconnect", async () => {
            await handleDisconnect(io, socket);
        });
    });
}
