import type { Card, CardRank, CardSuit } from "./types";

const suits: CardSuit[] = ["clubs", "diamonds", "hearts", "spades"];
const ranks: Exclude<CardRank, "JOKER">[] = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
];

export const cardsPerPlayer = 14;

export function createDeck(): Card[] {
    const cards: Card[] = [];

    for (let deckIndex = 1; deckIndex <= 2; deckIndex += 1) {
        for (const suit of suits) {
            for (const rank of ranks) {
                cards.push({
                    id: `deck-${deckIndex}-${rank}-${suit}`,
                    suit,
                    rank,
                });
            }
        }

        cards.push({
            id: `deck-${deckIndex}-JOKER`,
            suit: "joker",
            rank: "JOKER",
        });
    }

    return cards;
}

export function shuffleDeck(deck: Card[]) {
    const shuffled = [...deck];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        const currentCard = shuffled[index];
        const swappedCard = shuffled[swapIndex];

        if (!currentCard || !swappedCard) {
            continue;
        }

        shuffled[index] = swappedCard;
        shuffled[swapIndex] = currentCard;
    }

    return shuffled;
}
