import { cardsPerPlayer, createDeck, shuffleDeck } from "./deck";
import type { Card, GameParticipant, GamePlayer, PersistedGameState } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCard(value: unknown): value is Card {
    if (!isRecord(value)) {
        return false;
    }

    return typeof value.id === "string" && typeof value.suit === "string" && typeof value.rank === "string";
}

function isCardArray(value: unknown): value is Card[] {
    return Array.isArray(value) && value.every(isCard);
}

function isPlayer(value: unknown): value is GamePlayer {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        typeof value.connected === "boolean" &&
        isCardArray(value.hand)
    );
}

function isPersistedGameState(value: unknown): value is PersistedGameState {
    if (!isRecord(value)) {
        return false;
    }

    return (
        value.version === 1 &&
        typeof value.id === "string" &&
        typeof value.status === "string" &&
        typeof value.phase === "string" &&
        Array.isArray(value.players) &&
        value.players.every(isPlayer) &&
        isCardArray(value.deck) &&
        isCardArray(value.discardPile) &&
        (value.currentPlayerId === undefined || typeof value.currentPlayerId === "string")
    );
}

function playerName(participant: GameParticipant) {
    return participant.name.trim() || "Player";
}

export function createWaitingGameState(gameId: string, participants: GameParticipant[]): PersistedGameState {
    return {
        version: 1,
        id: gameId,
        status: "waiting",
        phase: "waiting",
        players: participants.map((participant) => ({
            id: participant.id,
            name: playerName(participant),
            connected: false,
            hand: [],
        })),
        deck: [],
        discardPile: [],
    };
}

export function restoreGameState(
    storedState: unknown,
    gameId: string,
    participants: GameParticipant[],
): PersistedGameState {
    if (!isPersistedGameState(storedState)) {
        return createWaitingGameState(gameId, participants);
    }

    const playerStates = new Map(storedState.players.map((player) => [player.id, player]));

    return {
        ...storedState,
        id: gameId,
        players: participants.map((participant) => {
            const storedPlayer = playerStates.get(participant.id);

            return {
                id: participant.id,
                name: playerName(participant),
                connected: storedPlayer?.connected ?? false,
                hand: storedPlayer?.hand ?? [],
            };
        }),
    };
}

export function syncPresence(state: PersistedGameState, connectedPlayerIds: Set<string>): PersistedGameState {
    if (state.status === "finished") {
        return state;
    }

    const players = state.players.map((player) => ({
        ...player,
        connected: connectedPlayerIds.has(player.id),
    }));
    const allPlayersConnected = players.length === 2 && players.every((player) => player.connected);

    if (state.status === "waiting") {
        return {
            ...state,
            players,
        };
    }

    return {
        ...state,
        status: allPlayersConnected ? "playing" : "paused",
        players,
    };
}

export function maybeStartGame(state: PersistedGameState): PersistedGameState {
    if (state.status !== "waiting" || state.players.length !== 2 || !state.players.every((player) => player.connected)) {
        return state;
    }

    const deck = shuffleDeck(createDeck());
    const players = state.players.map((player) => ({
        ...player,
        hand: deck.splice(0, cardsPerPlayer),
    }));

    return {
        ...state,
        status: "playing",
        phase: "draw",
        players,
        deck,
        discardPile: [],
        currentPlayerId: players[0]?.id,
    };
}
