import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../lib/db';

const JWT_SECRET = process.env.JWT_SECRET as string;

export const login = async (req: Request, res: Response) => {
try {
console.log("🟢 /api/v1/auth/login called");
    console.log("Headers:", req.headers);
    console.log("Body received:", req.body);

    if (!JWT_SECRET) {
      console.error("❌ Missing JWT_SECRET in environment");
      return res.status(500).json({ message: "Server misconfigured" });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      console.warn("⚠️ Missing email or password", { email, password });
      return res.status(400).json({ message: "Email and password are required" });
    }

    console.log("🔍 Querying DB for user:", email);
    const result = await db.query('SELECT * FROM users WHERE email=$1', [email]);

    console.log("📊 Query result:", result.rows);
    if (result.rows.length === 0) {
      console.warn("⚠️ No user found for email:", email);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];
    if (!user.password_hash) {
      console.error("❌ password_hash missing in DB row:", user);
      return res.status(500).json({ message: "User data misconfigured" });
    }

    console.log("🔑 Comparing password...");
    const valid = bcrypt.compareSync(password, user.password_hash);

    if (!valid) {
      console.warn("⚠️ Invalid password for user:", email);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log("✅ Password valid, generating JWT...");
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    console.log("🎉 Login successful for:", email);
    return res.json({ token });

  } catch (err: any) {
    console.error("🔥 Login error:", err);
    return res.status(500).json({ message: err.message });
  }
};
