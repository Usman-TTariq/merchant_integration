import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleRequest } from "../dist/ui/server.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await handleRequest(req, res);
}

export const config = {
  maxDuration: 300,
};
