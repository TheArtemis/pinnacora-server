import type { Card, CardRank, CardSuit, GameMeldType, PersistedGameState } from "./types";

const rankOrder: Record<CardRank, number> = {
    A: 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    J: 11,
    Q: 12,
    K: 13,
    JOKER: 0,
};

const suitOrder: Record<CardSuit, number> = {
    clubs: 0,
    diamonds: 1,
    hearts: 2,
    spades: 3,
    joker: 4,
};

function isSequential(values: number[]) {
    return values.every((value, index) => index === 0 || value === values[index - 1] + 1);
}

function sequenceValues(cards: Card[], aceHigh: boolean) {
    return cards
        .map((card) => (aceHigh && card.rank === "A" ? 14 : rankOrder[card.rank]))
        .sort((left, right) => left - right);
}

function getMeldType(cards: Card[]): GameMeldType | undefined {
    if (cards.length < 3 || cards.some((card) => card.rank === "JOKER" || card.suit === "joker")) {
        return undefined;
    }

    const rankCount = new Set(cards.map((card) => card.rank)).size;
    const suitCount = new Set(cards.map((card) => card.suit)).size;

    if (rankCount === 1 && suitCount === cards.length) {
        return "set";
    }

    if (suitCount !== 1 || rankCount !== cards.length) {
        return undefined;
    }

    const lowValues = sequenceValues(cards, false);
    const highValues = sequenceValues(cards, true);

    return isSequential(lowValues) || isSequential(highValues) ? "sequence" : undefined;
}

function sortMeldCards(cards: Card[], type: GameMeldType) {
    if (type === "set") {
        return [...cards].sort((left, right) => suitOrder[left.suit] - suitOrder[right.suit]);
    }

    const lowValues = sequenceValues(cards, false);
    const useAceHigh = !isSequential(lowValues) && isSequential(sequenceValues(cards, true));

    return [...cards].sort((left, right) => {
        const leftRank = useAceHigh && left.rank === "A" ? 14 : rankOrder[left.rank];
        const rightRank = useAceHigh && right.rank === "A" ? 14 : rankOrder[right.rank];

        return leftRank - rightRank;
    });
}

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

export function putDownMeld(state: PersistedGameState, playerId: string, cardIds: string[]) {
    if (state.status !== "playing") {
        return { error: "The game is not currently playable." };
    }

    if (state.currentPlayerId !== playerId) {
        return { error: "It is not your turn." };
    }

    if (state.phase !== "discard") {
        return { error: "Draw or pick up cards before putting down a combination." };
    }

    const uniqueCardIds = new Set(cardIds);

    if (uniqueCardIds.size !== cardIds.length) {
        return { error: "Choose each card only once." };
    }

    const currentPlayer = state.players.find((player) => player.id === playerId);

    if (!currentPlayer) {
        return { error: "Player is not in this game." };
    }

    const chosenCards = cardIds
        .map((cardId) => currentPlayer.hand.find((card) => card.id === cardId))
        .filter((card): card is Card => Boolean(card));

    if (chosenCards.length !== cardIds.length) {
        return { error: "Every card in the combination must be in your hand." };
    }

    const meldType = getMeldType(chosenCards);

    if (!meldType) {
        return { error: "Choose at least three cards with the same value in different suits, or a same-suit sequence." };
    }

    const chosenCardIds = new Set(cardIds);

    return {
        state: {
            ...state,
            melds: [
                ...state.melds,
                {
                    id: `${playerId}-${state.melds.length + 1}-${cardIds.join("-")}`,
                    playerId,
                    type: meldType,
                    cards: sortMeldCards(chosenCards, meldType),
                },
            ],
            players: state.players.map((player) =>
                player.id === playerId
                    ? {
                        ...player,
                        hand: player.hand.filter((card) => !chosenCardIds.has(card.id)),
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
