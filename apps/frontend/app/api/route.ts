import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export async function GET() {
  const publicDir = path.join(process.cwd(), "public", "avatars");
  const avatars = await fs.readdir(publicDir);

  return NextResponse.json({
    avatars,
  });
}
