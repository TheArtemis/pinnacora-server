import type { User } from "../generated/prisma/client";

export function serializeUser(user: User) {
    return {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        photoUrl: user.photoUrl,
    };
}
