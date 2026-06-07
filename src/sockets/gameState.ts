import type { Server } from "socket.io";
import { GameStatus, Prisma } from "../generated/prisma/client";
import { prisma } from "../db";
import {
    maybeStartGame,
    restoreGameState,
    serializeGameStateForPlayer,
    syncPresence,
    type GameParticipant,
    type PersistedGameState,
} from "../game/engine";
import { getConnectedPlayerIds } from "./presence";

function playerName(user: { displayName: string | null; email: string | null }) {
    return user.displayName ?? user.email ?? "Player";
}

function toGameParticipants(
    participants: Array<{
        userId: string;
        user: { displayName: string | null; email: string | null };
    }>,
): GameParticipant[] {
    return participants.map((participant) => ({
        id: participant.userId,
        name: playerName(participant.user),
    }));
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

export async function findPersistentGame(roomCode: string) {
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

export async function persistGameState(gameId: string, state: PersistedGameState) {
    await prisma.game.update({
        where: { id: gameId },
        data: {
            status: gameStatusFromState(state),
            winnerId: state.status === "finished" ? state.winnerId : null,
            finishedAt: state.status === "finished" ? new Date() : null,
            state: state as unknown as Prisma.InputJsonValue,
        },
    });
}

export async function emitGameState(io: Server, roomCode: string, state: PersistedGameState) {
    const sockets = await io.in(roomCode).fetchSockets();

    for (const roomSocket of sockets) {
        const viewerPlayerId = (roomSocket.data as { appUserId?: string }).appUserId;
        roomSocket.emit("game_state", serializeGameStateForPlayer(state, viewerPlayerId));
    }
}

export async function loadGameState(roomCode: string) {
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

export function restorePersistentGameState(
    persistentGame: Awaited<ReturnType<typeof findPersistentGame>>,
) {
    if (!persistentGame) {
        return undefined;
    }

    const participants = toGameParticipants(persistentGame.tournament.participants);

    return maybeStartGame(
        syncPresence(
            restoreGameState(persistentGame.state, persistentGame.roomCode, participants),
            getConnectedPlayerIds(persistentGame.roomCode),
        ),
    );
}
