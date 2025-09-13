import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../lib/db';

const JWT_SECRET = process.env.JWT_SECRET as string;

export const login = async (req: Request, res: Response) => {
try {
const { email, password } = req.body;

const result = await db.query('SELECT * FROM users WHERE email=$1', [email]);
if (result.rows.length === 0) return res.status(401).json({ message: 'Invalid credentials' });

    const user = result.rows[0];
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
