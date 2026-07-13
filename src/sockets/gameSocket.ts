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
    attachToMeld,
    swapMeldJoker,
    surrenderGame,
} from "../game/engine";
import {
    emitGameState,
    findPersistentGame,
    loadGameState,
    persistGameState,
    restorePersistentGameState,
} from "./gameState";
import { applyDevStatePatch, parseDevStatePatch } from "../game/devState";
import { devMode } from "../config/dev";
import { applyQueuedGameAction } from "./gameActionService";
import {
    getCardIdFromPayload,
    getCardIdsFromPayload,
    getClientActionIdFromPayload,
    getDiscardPileCountFromPayload,
    getDiscardPilePickupTargetFromPayload,
    getGameIdFromPayload,
    getJokerCardIdFromPayload,
    getMeldIdFromPayload,
    getReplacementCardIdFromPayload,
    getSocketGameData,
    getSocketToken,
    getSocketUser,
    setSocketUser,
} from "./socketData";

async function handleDrawCard(io: Server, socket: Socket, payload: unknown) {
    await applyQueuedGameAction(
        io,
        socket,
        getClientActionIdFromPayload(payload),
        (state, playerId) => drawCard(state, playerId),
    );
}

async function handleDiscardCard(io: Server, socket: Socket, payload: unknown) {
    const cardId = getCardIdFromPayload(payload);
    const clientActionId = getClientActionIdFromPayload(payload);

    if (!cardId) {
        socket.emit("game_error", { error: "Choose a card to discard.", clientActionId });
        return;
    }

    await applyQueuedGameAction(io, socket, clientActionId, (state, playerId) => discardCard(state, playerId, cardId));
}

async function handlePickUpDiscardPile(io: Server, socket: Socket, payload: unknown) {
    const count = getDiscardPileCountFromPayload(payload);
    const cardIds = getCardIdsFromPayload(payload);
    const pickupTarget = getDiscardPilePickupTargetFromPayload(payload);
    const clientActionId = getClientActionIdFromPayload(payload);

    if (count === undefined) {
        socket.emit("game_error", { error: "Choose cards from the discard pile to pick up.", clientActionId });
        return;
    }

    await applyQueuedGameAction(
        io,
        socket,
        clientActionId,
        (state, playerId) => pickUpDiscardPile(state, playerId, count, cardIds, pickupTarget),
    );
}

async function handlePutDownMeld(io: Server, socket: Socket, payload: unknown) {
    const cardIds = getCardIdsFromPayload(payload);
    const clientActionId = getClientActionIdFromPayload(payload);

    if (cardIds.length === 0) {
        socket.emit("game_error", { error: "Choose cards to put down.", clientActionId });
        return;
    }

    await applyQueuedGameAction(io, socket, clientActionId, (state, playerId) => putDownMeld(state, playerId, cardIds));
}

async function handleAttachToMeld(io: Server, socket: Socket, payload: unknown) {
    const meldId = getMeldIdFromPayload(payload);
    const cardIds = getCardIdsFromPayload(payload);
    const fallbackCardId = getCardIdFromPayload(payload);
    const resolvedCardIds = cardIds.length > 0 ? cardIds : (fallbackCardId ? [fallbackCardId] : []);
    const clientActionId = getClientActionIdFromPayload(payload);

    if (!meldId || resolvedCardIds.length === 0) {
        socket.emit("game_error", { error: "Choose one of your combinations and cards from your hand.", clientActionId });
        return;
    }

    await applyQueuedGameAction(
        io,
        socket,
        clientActionId,
        (state, playerId) => attachToMeld(state, playerId, meldId, resolvedCardIds),
    );
}

async function handleSurrender(io: Server, socket: Socket) {
    await applyQueuedGameAction(io, socket, undefined, (state, playerId) => surrenderGame(state, playerId));
}

async function handleSwapMeldJoker(io: Server, socket: Socket, payload: unknown) {
    const meldId = getMeldIdFromPayload(payload);
    const jokerCardId = getJokerCardIdFromPayload(payload);
    const replacementCardId = getReplacementCardIdFromPayload(payload);
    const clientActionId = getClientActionIdFromPayload(payload);

    if (!meldId || !jokerCardId || !replacementCardId) {
        socket.emit("game_error", { error: "Choose a table joker and a replacement card.", clientActionId });
        return;
    }

    await applyQueuedGameAction(
        io,
        socket,
        clientActionId,
        (state, playerId) => swapMeldJoker(state, playerId, meldId, jokerCardId, replacementCardId),
    );
}

function getHandHoverIndexesFromPayload(payload: unknown) {
    if (
        typeof payload !== "object" ||
        payload === null ||
        !("cardIndexes" in payload) ||
        !Array.isArray(payload.cardIndexes)
    ) {
        return [];
    }

    return payload.cardIndexes
        .filter((cardIndex): cardIndex is number => Number.isInteger(cardIndex) && cardIndex >= 0)
        .slice(0, 8);
}

function handleHoverHandCards(socket: Socket, payload: unknown) {
    const { appUserId, roomCode } = getSocketGameData(socket);

    if (!appUserId || !roomCode) {
        return;
    }

    socket.to(roomCode).emit("opponent_hand_hover", {
        playerId: appUserId,
        cardIndexes: getHandHoverIndexesFromPayload(payload),
    });
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

async function handleDevSetState(io: Server, socket: Socket, payload: unknown) {
    if (!devMode) {
        socket.emit("game_error", { error: "Dev mode is disabled on the server." });
        return;
    }

    const patch = parseDevStatePatch(payload);

    if (!patch) {
        socket.emit("game_error", { error: "Invalid dev state patch." });
        return;
    }

    const { appUserId, roomCode } = getSocketGameData(socket);

    if (!appUserId || !roomCode) {
        socket.emit("game_error", { error: "Join the game before editing dev state." });
        return;
    }

    const loaded = await loadGameState(roomCode);

    if ("error" in loaded) {
        socket.emit("game_error", { error: loaded.error });
        return;
    }

    try {
        const nextState = applyDevStatePatch(loaded.state, patch);
        await persistGameState(loaded.persistentGame.id, nextState);
        await emitGameState(io, roomCode, nextState);
    } catch (error) {
        socket.emit("game_error", {
            error: error instanceof Error ? error.message : "Could not apply dev state patch.",
        });
    }
}

async function handleDisconnect(io: Server, socket: Socket) {
    const { appUserId, roomCode } = getSocketGameData(socket);

    if (appUserId && roomCode) {
        socket.to(roomCode).emit("opponent_hand_hover", {
            playerId: appUserId,
            cardIndexes: [],
        });
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

        socket.on("draw_card", async (payload: unknown) => {
            await handleDrawCard(io, socket, payload);
        });

        socket.on("pick_up_discard_pile", async (payload: unknown) => {
            await handlePickUpDiscardPile(io, socket, payload);
        });

        socket.on("put_down_meld", async (payload: unknown) => {
            await handlePutDownMeld(io, socket, payload);
        });

        socket.on("attach_to_meld", async (payload: unknown) => {
            await handleAttachToMeld(io, socket, payload);
        });

        socket.on("swap_meld_joker", async (payload: unknown) => {
            await handleSwapMeldJoker(io, socket, payload);
        });

        socket.on("discard_card", async (payload: unknown) => {
            await handleDiscardCard(io, socket, payload);
        });

        socket.on("surrender", async () => {
            await handleSurrender(io, socket);
        });

        socket.on("hover_hand_cards", (payload: unknown) => {
            handleHoverHandCards(socket, payload);
        });

        socket.on("dev_set_state", async (payload: unknown) => {
            await handleDevSetState(io, socket, payload);
        });

        socket.on("disconnect", async () => {
            await handleDisconnect(io, socket);
        });
    });
}
