import type { PersistedGameState } from "./types";

export function drawCard(state: PersistedGameState, playerId: string) {
    if (state.status !== "playing") {
        return { error: "The game is not currently playable." };
    }

    if (state.currentPlayerId !== playerId) {
        return { error: "It is not your turn." };
    }

    if (state.phase !== "draw") {
        return { error: "You must discard before drawing again." };
    }

    const [drawnCard, ...deck] = state.deck;

    if (!drawnCard) {
        return { error: "The deck is empty." };
    }

    return {
        state: {
            ...state,
            phase: "discard" as const,
            deck,
            players: state.players.map((player) =>
                player.id === playerId
                    ? {
                        ...player,
                        hand: [...player.hand, drawnCard],
                    }
                    : player,
            ),
        },
    };
}

export function pickUpDiscardPile(state: PersistedGameState, playerId: string, count: number) {
    if (state.status !== "playing") {
        return { error: "The game is not currently playable." };
    }

    if (state.currentPlayerId !== playerId) {
        return { error: "It is not your turn." };
    }

    if (state.phase !== "draw") {
        return { error: "You must discard before picking up more cards." };
    }

    if (!Number.isInteger(count) || count <= 0) {
        return { error: "Choose at least one card from the discard pile." };
    }

    if (count > state.discardPile.length) {
        return { error: "There are not enough cards in the discard pile." };
    }

    const pickupStartIndex = state.discardPile.length - count;
    const pickedUpCards = state.discardPile.slice(pickupStartIndex);

    return {
        state: {
            ...state,
            phase: "discard" as const,
            discardPile: state.discardPile.slice(0, pickupStartIndex),
            players: state.players.map((player) =>
                player.id === playerId
                    ? {
                        ...player,
                        hand: [...player.hand, ...pickedUpCards],
                    }
                    : player,
            ),
        },
    };
}

export function discardCard(state: PersistedGameState, playerId: string, cardId: string) {
    if (state.status !== "playing") {
        return { error: "The game is not currently playable." };
    }

    if (state.currentPlayerId !== playerId) {
        return { error: "It is not your turn." };
    }

    if (state.phase !== "discard") {
        return { error: "Draw a card before discarding." };
    }

    const currentPlayerIndex = state.players.findIndex((player) => player.id === playerId);
    const currentPlayer = state.players[currentPlayerIndex];

    if (!currentPlayer) {
        return { error: "Player is not in this game." };
    }

    const cardIndex = currentPlayer.hand.findIndex((card) => card.id === cardId);
    const discardedCard = currentPlayer.hand[cardIndex];

    if (!discardedCard) {
        return { error: "That card is not in your hand." };
    }

    const nextPlayer = state.players[(currentPlayerIndex + 1) % state.players.length];

    return {
        state: {
            ...state,
            phase: "draw" as const,
            currentPlayerId: nextPlayer?.id,
            discardPile: [...state.discardPile, discardedCard],
            players: state.players.map((player) =>
                player.id === playerId
                    ? {
                        ...player,
                        hand: player.hand.filter((card) => card.id !== cardId),
                    }
                    : player,
            ),
        },
    };
}
