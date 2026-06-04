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
