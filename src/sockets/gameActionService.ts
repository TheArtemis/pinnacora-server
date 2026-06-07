import type { Server, Socket } from "socket.io";
import type { PersistedGameState } from "../game/engine";
import {
    emitGameState,
    loadGameState,
    persistGameState,
} from "./gameState";
import { getSocketGameData } from "./socketData";

type GameActionResult = { error: string } | { state: PersistedGameState };

const gameActionQueues = new Map<string, Promise<void>>();

export async function applyQueuedGameAction(
    io: Server,
    socket: Socket,
    clientActionId: string | undefined,
    applyAction: (state: PersistedGameState, playerId: string) => GameActionResult,
) {
    const queueKey = getSocketGameData(socket).roomCode ?? socket.id;
    const previousAction = gameActionQueues.get(queueKey) ?? Promise.resolve();
    const runAction = () => applyGameAction(io, socket, clientActionId, applyAction);
    const nextAction = previousAction.then(runAction, runAction);

    gameActionQueues.set(queueKey, nextAction);

    try {
        await nextAction;
    } catch (error) {
        console.error("game action failed:", error);
        emitGameActionError(socket, clientActionId, "Could not complete game action.");
    } finally {
        if (gameActionQueues.get(queueKey) === nextAction) {
            gameActionQueues.delete(queueKey);
        }
    }
}

function emitGameActionError(socket: Socket, clientActionId: string | undefined, error: string) {
    socket.emit("game_error", clientActionId ? { error, clientActionId } : { error });
}

async function applyGameAction(
    io: Server,
    socket: Socket,
    clientActionId: string | undefined,
    applyAction: (state: PersistedGameState, playerId: string) => GameActionResult,
) {
    const { appUserId, roomCode } = getSocketGameData(socket);

    if (!appUserId || !roomCode) {
        emitGameActionError(socket, clientActionId, "Join the game before taking a turn.");
        return;
    }

    const loaded = await loadGameState(roomCode);

    if ("error" in loaded) {
        emitGameActionError(socket, clientActionId, loaded.error ?? "Could not load game state.");
        return;
    }

    const result = applyAction(loaded.state, appUserId);

    if ("error" in result) {
        emitGameActionError(socket, clientActionId, result.error);
        return;
    }

    await persistGameState(loaded.persistentGame.id, result.state);

    if (clientActionId) {
        socket.emit("game_action_ack", { clientActionId });
    }

    await emitGameState(io, roomCode, result.state);
}
