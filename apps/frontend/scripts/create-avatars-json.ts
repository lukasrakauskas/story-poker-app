import path from "path";
import fs from "fs/promises";

export default async function execute() {
  const avatarsPath = path.join(process.cwd(), "public", "avatars");
  const avatarsJson = path.join(process.cwd(), "app", "avatars.json");
  const avatars = await fs.readdir(avatarsPath);

  await fs.writeFile(avatarsJson, JSON.stringify(avatars));
}
