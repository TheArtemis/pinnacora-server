import type { Card, CardRank, GameFinalScore, GameMeld, GameMeldType } from "./types";

export const FINISH_BONUS_POINTS = 100;

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

function sequenceCardValue(card: Card, aceHigh: boolean) {
    return aceHigh && card.rank === "A" ? 14 : rankOrder[card.rank];
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

function orderedSequenceAceHigh(cards: Card[]) {
    const lowBase = orderedSequenceBase(cards, false);

    if (lowBase !== undefined) {
        return false;
    }

    return orderedSequenceBase(cards, true) !== undefined ? true : undefined;
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

function sequenceValueToRank(value: number): CardRank | undefined {
    if (value === 14) {
        return "A";
    }

    const rankByValue: Record<number, CardRank> = {
        1: "A",
        2: "2",
        3: "3",
        4: "4",
        5: "5",
        6: "6",
        7: "7",
        8: "8",
        9: "9",
        10: "10",
        11: "J",
        12: "Q",
        13: "K",
    };

    return rankByValue[value];
}

function resolveSetJokerRank(cards: Card[]) {
    const naturalCard = cards.find((card) => !isJoker(card));

    return naturalCard?.rank;
}

function resolveSequenceJokerRank(cards: Card[], cardIndex: number) {
    const aceHigh = sequenceUsesAceHigh(cards);
    const sequenceBase = orderedSequenceBase(cards, aceHigh);

    if (sequenceBase === undefined) {
        return undefined;
    }

    return sequenceValueToRank(sequenceBase + cardIndex);
}

function resolveCardRank(cards: Card[], type: GameMeldType, cardIndex: number, card: Card) {
    if (!isJoker(card)) {
        return card.rank;
    }

    if (type === "set") {
        return resolveSetJokerRank(cards);
    }

    return resolveSequenceJokerRank(cards, cardIndex);
}

function isAceSet(cards: Card[]) {
    const naturalCards = cards.filter((card) => !isJoker(card));

    return cards.length >= 3 && naturalCards.length > 0 && naturalCards.every((card) => card.rank === "A");
}

function isJokerPoker(cards: Card[], type: GameMeldType) {
    return type === "set" && cards.length === 4 && cards.every(isJoker);
}

function isAcePoker(cards: Card[], type: GameMeldType) {
    return type === "set" && cards.length >= 4 && isAceSet(cards);
}

function isCompleteMeld(cards: Card[], type: GameMeldType) {
    if (type === "set") {
        return cards.length >= 4;
    }

    return cards.length >= 7 && !cards.some(isJoker);
}

function getRankPoints(rank: CardRank, aceCountsHigh: boolean) {
    if (rank === "A") {
        return aceCountsHigh ? 10 : 5;
    }

    return rankOrder[rank] <= 5 ? 5 : 10;
}

export function getMeldCardPoints(card: Card, aceCountsHigh: boolean) {
    if (isJoker(card)) {
        return 0;
    }

    return getRankPoints(card.rank, aceCountsHigh);
}

function getResolvedMeldCardPoints(
    cards: Card[],
    type: GameMeldType,
    cardIndex: number,
    card: Card,
    aceCountsHigh: boolean,
) {
    const resolvedRank = resolveCardRank(cards, type, cardIndex, card);

    if (!resolvedRank || resolvedRank === "JOKER") {
        return 0;
    }

    return getRankPoints(resolvedRank, aceCountsHigh);
}

export function getHandCardPenaltyPoints(card: Card) {
    if (isJoker(card)) {
        return 25;
    }

    return getRankPoints(card.rank, false);
}

export function calculateFinalScores(
    melds: GameMeld[],
    players: Array<{ id: string; hand: Card[] }>,
    finishingPlayerId: string,
): Record<string, GameFinalScore> {
    const scores: Record<string, GameFinalScore> = {};

    for (const player of players) {
        const meldPoints = melds
            .filter((meld) => meld.playerId === player.id)
            .reduce((total, meld) => total + meld.points, 0);
        const handPenalty = player.id === finishingPlayerId
            ? 0
            : player.hand.reduce((total, card) => total + getHandCardPenaltyPoints(card), 0);
        const finishBonus = player.id === finishingPlayerId ? FINISH_BONUS_POINTS : 0;

        scores[player.id] = {
            meldPoints,
            finishBonus,
            handPenalty,
            total: meldPoints + finishBonus - handPenalty,
        };
    }

    return scores;
}

export function determineWinnerId(
    finalScores: Record<string, GameFinalScore>,
    finishingPlayerId: string,
) {
    const entries = Object.entries(finalScores);

    if (entries.length === 0) {
        return undefined;
    }

    let [winnerId, winnerScore] = entries[0];

    for (const [playerId, score] of entries.slice(1)) {
        if (
            score.total > winnerScore.total ||
            (score.total === winnerScore.total && playerId === finishingPlayerId)
        ) {
            winnerId = playerId;
            winnerScore = score;
        }
    }

    return winnerId;
}

export function calculateMeldPoints(cards: Card[], type: GameMeldType) {
    if (isJokerPoker(cards, type)) {
        return 120;
    }

    if (isAcePoker(cards, type)) {
        return 100;
    }

    const aceCountsHigh = type === "sequence" ? isAceHighSequence(cards) : isAceSet(cards);
    const multiplier = isCompleteMeld(cards, type) ? 2 : 1;

    return cards.reduce(
        (total, card, cardIndex) => total + getResolvedMeldCardPoints(cards, type, cardIndex, card, aceCountsHigh) * multiplier,
        0,
    );
}
