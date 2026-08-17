const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'logo.png');
const OUT = (name) => path.join(__dirname, '..', 'public', name);

async function main() {
  const trimmed = sharp(SRC).trim();
  const trimmedBuffer = await trimmed.toBuffer();

  // Full logo (icon + wordmark), transparent bg, trimmed to content.
  await sharp(trimmedBuffer).png().toFile(OUT('logo-full.png'));

  // Icon-only crop (top portion, above the wordmark) for favicons/app icons.
  const iconRegion = await sharp(trimmedBuffer)
    .extract({ left: 200, top: 0, width: 800, height: 520 })
    .png()
    .toBuffer();

  const sizes = [16, 32, 180, 192, 512];
  for (const size of sizes) {
    await sharp(iconRegion)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(OUT(`icon-${size}.png`));
  }

  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
