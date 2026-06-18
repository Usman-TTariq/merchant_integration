import "dotenv/config";
import http from "node:http";

function fetchJson(path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:3847${path}`, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      })
      .on("error", reject);
  });
}

const searches = [
  "",
  "ee92a628-770d-46bd-8b8a-c9f2952a8206",
  "-770d-46bd-8b8a-c9f2952a8206",
];

for (const s of searches) {
  const q = s ? `&search=${encodeURIComponent(s)}` : "";
  const { status, body } = await fetchJson(`/api/korona/receipts?page=1${q}`);
  const b = body as Record<string, unknown>;
  console.log(JSON.stringify({ search: s || "(none)", status, receipts: b.receipts, error: b.error }));
}
