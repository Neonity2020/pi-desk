import { createPackageWithOptions } from '@electron/asar'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const appPath = join(root, 'release', 'Pi Desk.app')
const electronPath = join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
const resources = join(appPath, 'Contents', 'Resources')
const plist = join(appPath, 'Contents', 'Info.plist')
const staging = join(root, 'build', 'app-staging')

if (!existsSync(electronPath)) throw new Error('Electron is not installed. Run bun install first.')
rmSync(appPath, { recursive: true, force: true })
rmSync(staging, { recursive: true, force: true })
mkdirSync(dirname(appPath), { recursive: true })
mkdirSync(staging, { recursive: true })
execFileSync('ditto', [electronPath, appPath])
cpSync(join(root, 'out'), join(staging, 'out'), { recursive: true })
cpSync(join(root, 'vendor', 'node-pty'), join(staging, 'node_modules', 'node-pty'), { recursive: true })
writeFileSync(join(staging, 'package.json'), JSON.stringify({ name: 'pi-desk', version: '0.1.0', main: 'out/main/main.js', type: 'module' }))
await createPackageWithOptions(staging, join(resources, 'app.asar'), { unpackDir: 'node_modules/node-pty/prebuilds' })
rmSync(join(resources, 'default_app.asar'), { force: true })
cpSync(join(root, 'build', 'icon.icns'), join(resources, 'icon.icns'))
for (const [key, value] of Object.entries({
  CFBundleName: 'Pi Desk',
  CFBundleDisplayName: 'Pi Desk',
  CFBundleExecutable: 'Electron',
  CFBundleIdentifier: 'dev.pidesk.app',
  CFBundleIconFile: 'icon.icns',
  CFBundleShortVersionString: '0.1.0',
  LSApplicationCategoryType: 'public.app-category.developer-tools'
})) execFileSync('plutil', ['-replace', key, '-string', value, plist])
execFileSync('plutil', ['-remove', 'ElectronAsarIntegrity', plist])
try { execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'pipe' }) }
catch (error) { console.warn('Ad hoc signing skipped:', error.message) }
rmSync(staging, { recursive: true, force: true })
console.log(`Created ${appPath}`)
