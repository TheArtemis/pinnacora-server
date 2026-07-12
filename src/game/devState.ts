import { createDeck } from "./deck";
import { calculateMeldPoints } from "./scoring";
import type { Card, GameMeld, PersistedGameState } from "./types";

export type DevStatePatch = {
    status?: PersistedGameState["status"];
    phase?: PersistedGameState["phase"];
    currentPlayerId?: string;
    winnerId?: string;
    playerHands?: Record<string, Card[]>;
    discardPile?: Card[];
    melds?: Array<{
        id: string;
        playerId: string;
        type: GameMeld["type"];
        cards: Card[];
    }>;
};

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

function isMeldPatchArray(value: unknown): value is NonNullable<DevStatePatch["melds"]> {
    if (!Array.isArray(value)) {
        return false;
    }

    return value.every((meld) => {
        if (!isRecord(meld)) {
            return false;
        }

        return (
            typeof meld.id === "string" &&
            typeof meld.playerId === "string" &&
            (meld.type === "set" || meld.type === "sequence") &&
            isCardArray(meld.cards)
        );
    });
}

export function parseDevStatePatch(payload: unknown): DevStatePatch | null {
    if (!isRecord(payload)) {
        return null;
    }

    const patch: DevStatePatch = {};

    if (typeof payload.status === "string") {
        patch.status = payload.status as PersistedGameState["status"];
    }

    if (typeof payload.phase === "string") {
        patch.phase = payload.phase as PersistedGameState["phase"];
    }

    if (typeof payload.currentPlayerId === "string") {
        patch.currentPlayerId = payload.currentPlayerId;
    }

    if (typeof payload.winnerId === "string") {
        patch.winnerId = payload.winnerId;
    }

    if (isRecord(payload.playerHands)) {
        const playerHands: Record<string, Card[]> = {};

        for (const [playerId, hand] of Object.entries(payload.playerHands)) {
            if (!isCardArray(hand)) {
                return null;
            }

            playerHands[playerId] = hand;
        }

        patch.playerHands = playerHands;
    }

    if (isCardArray(payload.discardPile)) {
        patch.discardPile = payload.discardPile;
    }

    if (isMeldPatchArray(payload.melds)) {
        patch.melds = payload.melds;
    }

    return patch;
}

function collectUsedCardIds(state: PersistedGameState) {
    const usedIds = new Set<string>();

    for (const player of state.players) {
        for (const card of player.hand) {
            usedIds.add(card.id);
        }
    }

    for (const card of state.discardPile) {
        usedIds.add(card.id);
    }

    for (const meld of state.melds) {
        for (const card of meld.cards) {
            usedIds.add(card.id);
        }
    }

    return usedIds;
}

function assertNoDuplicateCards(cardGroups: Card[][]) {
    const seen = new Set<string>();

    for (const cards of cardGroups) {
        for (const card of cards) {
            if (seen.has(card.id)) {
                throw new Error(`Duplicate card: ${card.rank} of ${card.suit}`);
            }

            seen.add(card.id);
        }
    }
}

export function applyDevStatePatch(state: PersistedGameState, patch: DevStatePatch): PersistedGameState {
    const nextState: PersistedGameState = {
        ...state,
        status: patch.status ?? state.status,
        phase: patch.phase ?? state.phase,
        currentPlayerId: patch.currentPlayerId ?? state.currentPlayerId,
        winnerId: patch.winnerId ?? state.winnerId,
        players: patch.playerHands
            ? state.players.map((player) => ({
                ...player,
                hand: patch.playerHands?.[player.id] ?? player.hand,
            }))
            : state.players,
        discardPile: patch.discardPile ?? state.discardPile,
        melds: patch.melds
            ? patch.melds.map((meld) => ({
                ...meld,
                points: calculateMeldPoints(meld.cards, meld.type),
            }))
            : state.melds,
    };

    const fullDeck = createDeck();
    const usedIds = collectUsedCardIds(nextState);
    const deck = fullDeck.filter((card) => !usedIds.has(card.id));

    assertNoDuplicateCards([
        ...nextState.players.map((player) => player.hand),
        nextState.discardPile,
        ...nextState.melds.map((meld) => meld.cards),
        deck,
    ]);

    return {
        ...nextState,
        deck,
    };
}
