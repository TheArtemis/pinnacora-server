import type { NextFunction, Request, Response } from "express";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

export type AuthenticatedRequest = Request & {
  firebaseUser: DecodedIdToken;
};

function parseServiceAccount() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    return undefined;
  }

  const parsed = JSON.parse(serviceAccountJson) as Record<string, string | undefined>;
  const serviceAccount: ServiceAccount = {
    projectId: parsed.projectId ?? parsed.project_id,
    clientEmail: parsed.clientEmail ?? parsed.client_email,
    privateKey: parsed.privateKey ?? parsed.private_key,
  };

  if (serviceAccount.privateKey) {
    serviceAccount.privateKey = serviceAccount.privateKey.replace(/\\n/g, "\n");
  }

  return cert(serviceAccount);
}

function getFirebaseAuth() {
  if (!getApps().length) {
    initializeApp({
      credential: parseServiceAccount() ?? applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }

  return getAuth();
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
    (req as AuthenticatedRequest).firebaseUser = await getFirebaseAuth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired Firebase token." });
  }
}
