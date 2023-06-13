import path from "path";
import fs from "fs/promises";

async function main() {
  const dir = path.join(process.cwd(), "scripts");
  const files = await fs.readdir(dir);
  const filteredFiles = files.filter((file) => !__filename.endsWith(file));

  const promises = filteredFiles.map((file) =>
    import(`./${file}`).then(
      ({ default: defaultFunc }: { default: () => void }) => {
        try {
          defaultFunc();
          console.log(`Successfully executed: ${file}`);
        } catch (e) {
          console.log(`Failed to execute: ${file}`);
        }
      }
    )
  );

  await Promise.allSettled(promises);
}

main();
