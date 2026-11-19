interface VercelRequestLike {
  method?: string;
}

interface VercelResponseLike {
  status(code: number): VercelResponseLike;
  setHeader(name: string, value: string): VercelResponseLike;
  json(body: unknown): void;
}

export default function handler(req: VercelRequestLike, res: VercelResponseLike): void {
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok' });
}
