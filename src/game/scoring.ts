import type { Card, CardRank, GameMeldType } from "./types";

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

function isJoker(card: Card) {
    return card.rank === "JOKER" || card.suit === "joker";
}

function sequenceValues(cards: Card[], aceHigh: boolean) {
    return cards
        .filter((card) => !isJoker(card))
        .map((card) => (aceHigh && card.rank === "A" ? 14 : rankOrder[card.rank]))
        .sort((left, right) => left - right);
}

function canFitSequence(values: number[], totalCards: number) {
    const [firstValue] = values;
    const lastValue = values[values.length - 1];

    if (firstValue === undefined || lastValue === undefined) {
        return false;
    }

    return lastValue - firstValue + 1 <= totalCards;
}

function isAceHighSequence(cards: Card[]) {
    const lowValues = sequenceValues(cards, false);
    const highValues = sequenceValues(cards, true);

    return !canFitSequence(lowValues, cards.length) && canFitSequence(highValues, cards.length);
}

function isAceSet(cards: Card[]) {
    const naturalCards = cards.filter((card) => !isJoker(card));

    return cards.length >= 3 && naturalCards.length > 0 && naturalCards.every((card) => card.rank === "A");
}

function isCompleteMeld(cards: Card[], type: GameMeldType) {
    if (type === "set") {
        return cards.length >= 4;
    }

    const naturalValues = new Set(
        cards
            .filter((card) => !isJoker(card))
            .map((card) => (card.rank === "A" ? 1 : rankOrder[card.rank])),
    );
    const jokerCount = cards.filter(isJoker).length;

    return cards.length >= 13 && naturalValues.size + jokerCount >= 13;
}

export function getMeldCardPoints(card: Card, aceCountsHigh: boolean) {
    if (isJoker(card)) {
        return 0;
    }

    if (card.rank === "A") {
        return aceCountsHigh ? 10 : 5;
    }

    return rankOrder[card.rank] <= 5 ? 5 : 10;
}

export function calculateMeldPoints(cards: Card[], type: GameMeldType) {
    const aceCountsHigh = type === "sequence" ? isAceHighSequence(cards) : isAceSet(cards);
    const multiplier = isCompleteMeld(cards, type) ? 2 : 1;

    return cards.reduce((total, card) => total + getMeldCardPoints(card, aceCountsHigh) * multiplier, 0);
}
