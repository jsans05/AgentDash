/**
 * CreatorIQ monthly snapshot refresh.
 * Disabled: CreatorIQ/CIQ integration has been removed from the app.
 */

const RATE_LIMIT_MS_MIN = 300;
const RATE_LIMIT_MS_MAX = 600;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  console.log(
    "CreatorIQ monthly refresh disabled: CreatorIQ/CIQ integration has been removed from this app."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
