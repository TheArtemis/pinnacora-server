import type { DecodedIdToken } from "firebase-admin/auth";
import type { Socket } from "socket.io";

export function getSocketToken(socket: Socket) {
    const token = socket.handshake.auth.token;
    return typeof token === "string" && token.trim().length > 0 ? token : undefined;
}

export function getSocketUser(socket: Socket) {
    return (socket.data as { firebaseUser: DecodedIdToken }).firebaseUser;
}

export function setSocketUser(socket: Socket, firebaseUser: DecodedIdToken) {
    (socket.data as { firebaseUser?: DecodedIdToken }).firebaseUser = firebaseUser;
}

export function getSocketGameData(socket: Socket) {
    return socket.data as {
        appUserId?: string;
        roomCode?: string;
    };
}

export function getGameIdFromPayload(payload: unknown) {
    if (typeof payload === "string") {
        return payload.trim();
    }

    if (
        typeof payload === "object" &&
        payload !== null &&
        "gameId" in payload &&
        typeof payload.gameId === "string"
    ) {
        return payload.gameId.trim();
    }

    return "";
}

export function getCardIdFromPayload(payload: unknown) {
    if (
        typeof payload === "object" &&
        payload !== null &&
        "cardId" in payload &&
        typeof payload.cardId === "string"
    ) {
        return payload.cardId.trim();
    }

    return "";
}

function getStringFromPayload(payload: unknown, fieldName: string) {
    if (
        typeof payload === "object" &&
        payload !== null &&
        fieldName in payload
    ) {
        const value = (payload as Record<string, unknown>)[fieldName];

        return typeof value === "string" ? value.trim() : "";
    }

    return "";
}

export function getMeldIdFromPayload(payload: unknown) {
    return getStringFromPayload(payload, "meldId");
}

export function getJokerCardIdFromPayload(payload: unknown) {
    return getStringFromPayload(payload, "jokerCardId");
}

export function getReplacementCardIdFromPayload(payload: unknown) {
    return getStringFromPayload(payload, "replacementCardId");
}

export function getClientActionIdFromPayload(payload: unknown) {
    if (
        typeof payload === "object" &&
        payload !== null &&
        "clientActionId" in payload &&
        typeof payload.clientActionId === "string"
    ) {
        const clientActionId = payload.clientActionId.trim();

        return clientActionId || undefined;
    }

    return undefined;
}

export function getCardIdsFromPayload(payload: unknown) {
    if (
        typeof payload === "object" &&
        payload !== null &&
        "cardIds" in payload &&
        Array.isArray(payload.cardIds)
    ) {
        return payload.cardIds
            .filter((cardId): cardId is string => typeof cardId === "string")
            .map((cardId) => cardId.trim())
            .filter(Boolean);
    }

    return [];
}

export function getDiscardPileCountFromPayload(payload: unknown) {
    if (
        typeof payload === "object" &&
        payload !== null &&
        "count" in payload &&
        typeof payload.count === "number"
    ) {
        return payload.count;
    }

    return undefined;
}

export type DiscardPilePickupTarget =
    | { type: "new_meld" }
    | { type: "extend_meld"; meldId: string }
    | { type: "swap_joker"; meldId: string; jokerCardId: string };

export function getDiscardPilePickupTargetFromPayload(payload: unknown): DiscardPilePickupTarget | undefined {
    if (
        typeof payload !== "object" ||
        payload === null ||
        !("pickupTarget" in payload) ||
        typeof payload.pickupTarget !== "object" ||
        payload.pickupTarget === null ||
        !("type" in payload.pickupTarget) ||
        typeof payload.pickupTarget.type !== "string"
    ) {
        return undefined;
    }

    const pickupTarget = payload.pickupTarget as Record<string, unknown>;

    if (pickupTarget.type === "new_meld") {
        return { type: "new_meld" };
    }

    if (pickupTarget.type === "extend_meld" && typeof pickupTarget.meldId === "string") {
        const meldId = pickupTarget.meldId.trim();

        return meldId ? { type: "extend_meld", meldId } : undefined;
    }

    if (
        pickupTarget.type === "swap_joker" &&
        typeof pickupTarget.meldId === "string" &&
        typeof pickupTarget.jokerCardId === "string"
    ) {
        const meldId = pickupTarget.meldId.trim();
        const jokerCardId = pickupTarget.jokerCardId.trim();

        return meldId && jokerCardId ? { type: "swap_joker", meldId, jokerCardId } : undefined;
    }

    return undefined;
}
