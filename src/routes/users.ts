import { Router } from "express";
import type { Request, Response } from "express";
import { requireFirebaseAuth, type AuthenticatedRequest } from "../auth/firebase";
import { prisma } from "../db";
import { isUniqueConstraintError } from "../db/errors";
import { optionalString } from "../http/request";

type UserRequestBody = {
  displayName?: unknown;
  photoUrl?: unknown;
  username?: unknown;
};

const router = Router();

function optionalUsername(value: unknown) {
  return optionalString(value)?.toLowerCase();
}

router.post("/", requireFirebaseAuth, async (req: Request, res: Response) => {
  const firebaseUser = (req as AuthenticatedRequest).firebaseUser;
  const body = req.body as UserRequestBody;
  const displayName = optionalString(body.displayName) ?? firebaseUser.name ?? null;
  const photoUrl = optionalString(body.photoUrl) ?? firebaseUser.picture ?? null;
  const username = optionalUsername(body.username);

  try {
    const user = await prisma.user.upsert({
      where: { firebaseUid: firebaseUser.uid },
      update: {
        email: firebaseUser.email ?? null,
        emailVerified: Boolean(firebaseUser.email_verified),
        displayName,
        photoUrl,
        username,
        lastLoginAt: new Date(),
      },
      create: {
        firebaseUid: firebaseUser.uid,
        email: firebaseUser.email ?? null,
        emailVerified: Boolean(firebaseUser.email_verified),
        displayName,
        photoUrl,
        username,
        lastLoginAt: new Date(),
      },
    });

    res.status(201).json({ user });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "Email or username is already in use." });
      return;
    }

    throw error;
  }
});

router.get("/me", requireFirebaseAuth, async (req: Request, res: Response) => {
  const firebaseUser = (req as AuthenticatedRequest).firebaseUser;

  const user = await prisma.user.findUnique({
    where: { firebaseUid: firebaseUser.uid },
  });

  if (!user) {
    res.status(404).json({ error: "User has not been created yet." });
    return;
  }

  res.json({ user });
});

export default router;
