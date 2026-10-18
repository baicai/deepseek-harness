/** Export provisional 贸号 brand artwork for desktop icon assets. Replace source SVG with approved uploaded artwork. */
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
