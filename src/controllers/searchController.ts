import { Request, Response } from 'express';
import db from '../lib/db';
import { embedQuery } from '../utils/chunkEmbed';

export const searchResource = async (req: Request, res: Response) => {
try {
const resourceId = req.params.id;
const { query } = req.body;

const queryVector = embedQuery(query);

const result = await db.query(
`SELECT text, metadata FROM chunks
WHERE resource_id=$1
ORDER BY embedding <#> $2
LIMIT 5`,
[resourceId, queryVector]
);

res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
