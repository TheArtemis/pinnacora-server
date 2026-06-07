import type { Card, CardRank, CardSuit, GameMeldType, PersistedGameState } from "./types";
import { calculateMeldPoints } from "./scoring";

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

function sequenceValues(cards: Card[], aceHigh: boolean) {
    return cards
        .filter((card) => card.rank !== "JOKER")
        .map((card) => sequenceCardValue(card, aceHigh))
        .sort((left, right) => left - right);
}

function isJoker(card: Card) {
    return card.rank === "JOKER" || card.suit === "joker";
}

function sequenceCardValue(card: Card, aceHigh: boolean) {
    return aceHigh && card.rank === "A" ? 14 : rankOrder[card.rank];
}

function isValidSet(cards: Card[]) {
    const naturalCards = cards.filter((card) => !isJoker(card));

    if (naturalCards.length === 0 || cards.length > 4) {
        return false;
    }

    const rankCount = new Set(naturalCards.map((card) => card.rank)).size;
    const suitCount = new Set(naturalCards.map((card) => card.suit)).size;

    return rankCount === 1 && suitCount === naturalCards.length;
}

function canFitSequence(values: number[], totalCards: number) {
    const [firstValue] = values;
    const lastValue = values[values.length - 1];

    if (firstValue === undefined || lastValue === undefined) {
        return false;
    }

    return lastValue - firstValue + 1 <= totalCards;
}

function isValidSequence(cards: Card[]) {
    const naturalCards = cards.filter((card) => !isJoker(card));

    if (naturalCards.length === 0) {
        return false;
    }

    const suitCount = new Set(naturalCards.map((card) => card.suit)).size;
    const rankCount = new Set(naturalCards.map((card) => card.rank)).size;

    if (suitCount !== 1 || rankCount !== naturalCards.length) {
        return false;
    }

    return canFitSequence(sequenceValues(naturalCards, false), cards.length) ||
        canFitSequence(sequenceValues(naturalCards, true), cards.length);
}

function orderedSequenceAceHigh(cards: Card[]) {
    const lowBase = orderedSequenceBase(cards, false);

    if (lowBase !== undefined) {
        return false;
    }

    return orderedSequenceBase(cards, true) !== undefined ? true : undefined;
}

function orderedSequenceBase(cards: Card[], aceHigh: boolean) {
    let sequenceBase: number | undefined;

    for (const [index, card] of cards.entries()) {
        if (isJoker(card)) {
            continue;
        }

        const cardBase = sequenceCardValue(card, aceHigh) - index;

        if (sequenceBase === undefined) {
            sequenceBase = cardBase;
        } else if (sequenceBase !== cardBase) {
            return undefined;
        }
    }

    if (sequenceBase === undefined) {
        return undefined;
    }

    const highestValue = sequenceBase + cards.length - 1;

    if (sequenceBase < 1 || highestValue > (aceHigh ? 14 : 13)) {
        return undefined;
    }

    return sequenceBase;
}

function sequenceUsesAceHigh(cards: Card[]) {
    const orderedAceHigh = orderedSequenceAceHigh(cards);

    if (orderedAceHigh !== undefined) {
        return orderedAceHigh;
    }

    const lowValues = sequenceValues(cards, false);
    const highValues = sequenceValues(cards, true);

    return !canFitSequence(lowValues, cards.length) && canFitSequence(highValues, cards.length);
}

function sortSequenceCards(cards: Card[]) {
    const useAceHigh = sequenceUsesAceHigh(cards);

    if (cards.some(isJoker) && orderedSequenceAceHigh(cards) !== undefined) {
        return [...cards];
    }

    const jokers = cards.filter(isJoker);
    const naturalCards = cards
        .filter((card) => !isJoker(card))
        .sort((left, right) => sequenceCardValue(left, useAceHigh) - sequenceCardValue(right, useAceHigh));
    const sortedCards: Card[] = [];
    const maxValue = useAceHigh ? 14 : 13;

    for (const card of naturalCards) {
        const previousNaturalCard = [...sortedCards].reverse().find((candidateCard) => !isJoker(candidateCard));

        if (previousNaturalCard) {
            const gapSize = sequenceCardValue(card, useAceHigh) - sequenceCardValue(previousNaturalCard, useAceHigh) - 1;

            for (let gapIndex = 0; gapIndex < gapSize && jokers.length > 0; gapIndex += 1) {
                const joker = jokers.shift();

                if (joker) {
                    sortedCards.push(joker);
                }
            }
        }

        sortedCards.push(card);
    }

    while (jokers.length > 0) {
        const firstNaturalCard = sortedCards.find((card) => !isJoker(card));
        const lastNaturalCard = [...sortedCards].reverse().find((card) => !isJoker(card));
        const joker = jokers.shift();

        if (!joker) {
            continue;
        }

        if (lastNaturalCard && sequenceCardValue(lastNaturalCard, useAceHigh) + 1 > maxValue && firstNaturalCard) {
            sortedCards.unshift(joker);
        } else {
            sortedCards.push(joker);
        }
    }

    return sortedCards;
}

function isMeldInCardOrder(cards: Card[], type: GameMeldType) {
    if (type === "set") {
        return getMeldType(cards) === type;
    }

    return orderedSequenceAceHigh(cards) !== undefined;
}

function getMeldType(cards: Card[]): GameMeldType | undefined {
    if (cards.length < 3) {
        return undefined;
    }

    if (isValidSet(cards)) {
        return "set";
    }

    return isValidSequence(cards) ? "sequence" : undefined;
}

function sortMeldCards(cards: Card[], type: GameMeldType) {
    if (type === "set") {
        return [...cards].sort((left, right) => suitOrder[left.suit] - suitOrder[right.suit]);
    }

    return sortSequenceCards(cards);
}

type DiscardPilePickupTarget =
    | { type: "new_meld" }
    | { type: "extend_meld"; meldId: string }
    | { type: "swap_joker"; meldId: string; jokerCardId: string };

function canAddCardToMeld(meld: { type: GameMeldType; cards: Card[] }, card: Card) {
    const nextMeldCards = [...meld.cards, card];
    const nextMeldType = getMeldType(nextMeldCards);

    return nextMeldType === meld.type;
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

export function pickUpDiscardPile(
    state: PersistedGameState,
    playerId: string,
    count: number,
    meldCardIds: string[],
    pickupTarget: DiscardPilePickupTarget = { type: "new_meld" },
) {
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

    const uniqueMeldCardIds = new Set(meldCardIds);

    if (uniqueMeldCardIds.size !== meldCardIds.length) {
        return { error: "Choose each card only once." };
    }

    const currentPlayer = state.players.find((player) => player.id === playerId);

    if (!currentPlayer) {
        return { error: "Player is not in this game." };
    }

    const pickupStartIndex = state.discardPile.length - count;
    const requiredDiscardCard = state.discardPile[pickupStartIndex];
    const pickedUpCards = state.discardPile.slice(pickupStartIndex);
    const cardsAddedToHand = pickedUpCards.slice(1);
    const chosenHandCards = meldCardIds
        .map((cardId) => currentPlayer.hand.find((card) => card.id === cardId))
        .filter((card): card is Card => Boolean(card));

    if (!requiredDiscardCard) {
        return { error: "Choose a card from the discard pile to combine." };
    }

    if (chosenHandCards.length !== meldCardIds.length) {
        return { error: "Every card in the combination must be in your hand." };
    }

    const nextHand = [
        ...currentPlayer.hand.filter((card) => !uniqueMeldCardIds.has(card.id)),
        ...cardsAddedToHand,
    ];
    const baseState = {
        ...state,
        phase: "discard" as const,
        discardPile: state.discardPile.slice(0, pickupStartIndex),
        players: state.players.map((player) =>
            player.id === playerId
                ? {
                    ...player,
                    hand: nextHand,
                }
                : player,
        ),
    };

    if (pickupTarget.type === "extend_meld") {
        const targetMeld = state.melds.find((meld) => meld.id === pickupTarget.meldId);

        if (!targetMeld || targetMeld.playerId !== playerId || !canAddCardToMeld(targetMeld, requiredDiscardCard)) {
            return { error: "That discard card cannot be added to that combination." };
        }

        const nextMeldCards = [...targetMeld.cards, requiredDiscardCard];
        const sortedMeldCards = sortMeldCards(nextMeldCards, targetMeld.type);

        return {
            state: {
                ...baseState,
                melds: state.melds.map((meld) =>
                    meld.id === targetMeld.id
                        ? {
                            ...meld,
                            cards: sortedMeldCards,
                            points: calculateMeldPoints(sortedMeldCards, meld.type),
                        }
                        : meld,
                ),
            },
        };
    }

    if (pickupTarget.type === "swap_joker") {
        const targetMeld = state.melds.find((meld) => meld.id === pickupTarget.meldId);
        const jokerCard = targetMeld?.cards.find((card) => card.id === pickupTarget.jokerCardId);

        if (!targetMeld || !jokerCard || !isJoker(jokerCard) || isJoker(requiredDiscardCard)) {
            return { error: "That discard card cannot replace this joker." };
        }

        const nextMeldCards = targetMeld.cards.map((card) =>
            card.id === pickupTarget.jokerCardId ? requiredDiscardCard : card,
        );
        const nextMeldType = getMeldType(nextMeldCards);

        if (nextMeldType !== targetMeld.type || !isMeldInCardOrder(nextMeldCards, nextMeldType)) {
            return { error: "That discard card cannot replace this joker." };
        }

        const sortedMeldCards = sortMeldCards(nextMeldCards, nextMeldType);

        return {
            state: {
                ...baseState,
                melds: state.melds.map((meld) =>
                    meld.id === targetMeld.id
                        ? {
                            ...meld,
                            cards: sortedMeldCards,
                            points: calculateMeldPoints(sortedMeldCards, nextMeldType),
                        }
                        : meld,
                ),
                players: baseState.players.map((player) =>
                    player.id === playerId
                        ? {
                            ...player,
                            hand: [...player.hand, jokerCard],
                        }
                        : player,
                ),
            },
        };
    }

    const meldCards = [requiredDiscardCard, ...chosenHandCards];
    const meldType = getMeldType(meldCards);

    if (!meldType) {
        return { error: "The selected discard card must make a valid combination with cards from your hand." };
    }

    const sortedMeldCards = sortMeldCards(meldCards, meldType);

    return {
        state: {
            ...baseState,
            melds: [
                ...state.melds,
                {
                    id: `${playerId}-${state.melds.length + 1}-${[requiredDiscardCard.id, ...meldCardIds].join("-")}`,
                    playerId,
                    type: meldType,
                    cards: sortedMeldCards,
                    points: calculateMeldPoints(sortedMeldCards, meldType),
                },
            ],
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

    const sortedMeldCards = sortMeldCards(chosenCards, meldType);

    return {
        state: {
            ...state,
            melds: [
                ...state.melds,
                {
                    id: `${playerId}-${state.melds.length + 1}-${cardIds.join("-")}`,
                    playerId,
                    type: meldType,
                    cards: sortedMeldCards,
                    points: calculateMeldPoints(sortedMeldCards, meldType),
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

export function swapMeldJoker(
    state: PersistedGameState,
    playerId: string,
    meldId: string,
    jokerCardId: string,
    replacementCardId: string,
) {
    if (state.status !== "playing") {
        return { error: "The game is not currently playable." };
    }

    if (state.currentPlayerId !== playerId) {
        return { error: "It is not your turn." };
    }

    if (state.phase !== "discard") {
        return { error: "Draw or pick up cards before swapping a joker." };
    }

    const currentPlayer = state.players.find((player) => player.id === playerId);

    if (!currentPlayer) {
        return { error: "Player is not in this game." };
    }

    const meld = state.melds.find((candidateMeld) => candidateMeld.id === meldId);

    if (!meld) {
        return { error: "That table combination was not found." };
    }

    const jokerCard = meld.cards.find((card) => card.id === jokerCardId);

    if (!jokerCard || !isJoker(jokerCard)) {
        return { error: "Choose a joker from a table combination." };
    }

    const replacementCard = currentPlayer.hand.find((card) => card.id === replacementCardId);

    if (!replacementCard) {
        return { error: "That replacement card is not in your hand." };
    }

    if (isJoker(replacementCard)) {
        return { error: "Use a non-joker card to replace a table joker." };
    }

    const nextMeldCards = meld.cards.map((card) => (card.id === jokerCardId ? replacementCard : card));
    const nextMeldType = getMeldType(nextMeldCards);

    if (nextMeldType !== meld.type || !isMeldInCardOrder(nextMeldCards, nextMeldType)) {
        return { error: "That card cannot replace this joker in the combination." };
    }

    const sortedMeldCards = sortMeldCards(nextMeldCards, nextMeldType);

    return {
        state: {
            ...state,
            melds: state.melds.map((candidateMeld) =>
                candidateMeld.id === meldId
                    ? {
                        ...candidateMeld,
                        cards: sortedMeldCards,
                        points: calculateMeldPoints(sortedMeldCards, nextMeldType),
                    }
                    : candidateMeld,
            ),
            players: state.players.map((player) =>
                player.id === playerId
                    ? {
                        ...player,
                        hand: [
                            ...player.hand.filter((card) => card.id !== replacementCardId),
                            jokerCard,
                        ],
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
