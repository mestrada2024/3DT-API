import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface LoginResult {
  id: number;
  username: string;
  role: string;
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<LoginResult | null> {

  const user = await prisma.user.findUnique({
    where: {
      username
    }
  });

  if (!user || !user.active) {
    return null;
  }

  const passwordValid = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!passwordValid) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role
  };
}
