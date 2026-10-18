/** Render desktop icon assets from the user-supplied cropped 贸号 logo embedded in the replaceable SVG master. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
const root = fileURLToPath(new URL('../resources/', import.meta.url))
const source = await readFile(resolve(root, 'imaohao-prototype.svg'))
for (const file of ['icon.png', 'icon-windows.png', 'icon-macos.png']) {
  const output = await sharp(source).resize(1024, 1024).png().toBuffer()
  await writeFile(resolve(root, file), output)
  console.log('wrote', file)
}
const svg = source.toString('utf8')
for (const file of ['icon.svg', 'icon-windows.svg', 'icon-macos.svg']) {
  await writeFile(resolve(root, file), svg)
  console.log('wrote', file)
}

// The NSIS welcome/finish/progress screens use completely separate bitmaps.
// Rasterize them from the real uploaded 贸号 wordmark on every branded build;
// otherwise the installer continues to show DeepSeek even when its .exe icon changed.
const assetsRoot = fileURLToPath(new URL('../installer/assets/', import.meta.url))
const wordmark = await readFile(fileURLToPath(new URL('../renderer/assets/welcome-brand.svg', import.meta.url)))
const bareMark = await readFile(fileURLToPath(new URL('../../web/public/imaohao-brand.svg', import.meta.url)))
for (const file of ['brand.png', 'brand-2x.png', 'brand-dark.png', 'brand-dark-2x.png', 'uninstaller-sidebar.png']) {
  const path = resolve(assetsRoot, file)
  // Existing asset dimensions are used so the pinned NSIS layout stays unchanged.
  const metadata = await sharp(path).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('Invalid NSIS branding image dimensions: ' + file)
  const source = file === 'uninstaller-sidebar.png' ? bareMark : wordmark
  const image = await sharp(source)
    .resize({ width: Math.max(1, Math.floor(width * 0.87)), height: Math.max(1, Math.floor(height * 0.75)), fit: 'inside' })
    .png().toBuffer()
  const { width: artWidth, height: artHeight } = await sharp(image).metadata()
  if (!artWidth || !artHeight) throw new Error('Invalid NSIS wordmark: ' + file)
  const raster = await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
    .composite([{ input: image, left: Math.floor((width - artWidth) / 2), top: Math.floor((height - artHeight) / 2) }])
    .png().toBuffer()
  await writeFile(path, raster)
  console.log('wrote NSIS branding', file, width + 'x' + height)
}
