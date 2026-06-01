import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleRequest } from "../dist/ui/server.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const config = {
  maxDuration: 300,
};
