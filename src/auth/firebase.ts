import type { NextFunction, Request, Response } from "express";
import {
    cert,
    getApps,
    initializeApp,
    type ServiceAccount,
} from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

export type AuthenticatedRequest = Request & {
    firebaseUser: DecodedIdToken;
};

function trimEnvValue(value: string | undefined) {
    if (!value) {
        return undefined;
    }

    const trimmed = value.trim();

    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }

    return trimmed;
}

function normalizeServiceAccountJson(rawValue: string) {
    let normalized = rawValue.trim();

    while (
        (normalized.startsWith("'") && normalized.endsWith("'")) ||
        (normalized.startsWith('"') && normalized.endsWith('"'))
    ) {
        normalized = normalized.slice(1, -1).trim();
    }

    return normalized;
}

function parseServiceAccountJson() {
    const rawValue = trimEnvValue(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

    if (!rawValue) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
    }

    const parsed = JSON.parse(normalizeServiceAccountJson(rawValue)) as Record<
        string,
        string | undefined
    >;
    const serviceAccount: ServiceAccount = {
        projectId: parsed.projectId ?? parsed.project_id,
        clientEmail: parsed.clientEmail ?? parsed.client_email,
        privateKey: parsed.privateKey ?? parsed.private_key,
    };

    if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
        throw new Error(
            "FIREBASE_SERVICE_ACCOUNT_JSON is missing projectId, clientEmail, or privateKey.",
        );
    }

    serviceAccount.privateKey = serviceAccount.privateKey.replace(/\\n/g, "\n");

    return serviceAccount;
}

export function getFirebaseProjectId() {
    const projectId = trimEnvValue(process.env.FIREBASE_PROJECT_ID);

    if (!projectId) {
        throw new Error("FIREBASE_PROJECT_ID is not set.");
    }

    return projectId;
}

function getFirebaseAuth() {
    if (!getApps().length) {
        initializeApp({
            credential: cert(parseServiceAccountJson()),
            projectId: getFirebaseProjectId(),
        });
    }

    return getAuth();
}

export function validateFirebaseConfig() {
    const serviceAccount = parseServiceAccountJson();
    const projectId = getFirebaseProjectId();

    if (serviceAccount.projectId !== projectId) {
        throw new Error(
            `Firebase project mismatch: FIREBASE_PROJECT_ID is "${projectId}" but service account project is "${serviceAccount.projectId}".`,
        );
    }

    console.log(`Firebase Admin configured for project "${projectId}".`);
}

export function verifyFirebaseToken(token: string) {
    return getFirebaseAuth().verifyIdToken(token);
}

function getBearerToken(req: Request) {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
        return undefined;
    }

    return authHeader.slice("Bearer ".length);
}

export async function requireFirebaseAuth(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    const token = getBearerToken(req);

    if (!token) {
        res.status(401).json({ error: "Missing Firebase bearer token." });
        return;
    }

    try {
        (req as AuthenticatedRequest).firebaseUser = await verifyFirebaseToken(token);
        next();
    } catch (error) {
        console.error("Firebase token verification failed:", error);
        res.status(401).json({ error: "Invalid or expired Firebase token." });
    }
}
