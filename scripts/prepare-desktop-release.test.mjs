import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareRelease } from './prepare-desktop-release.mjs';

function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'desktop-release-'));
  const assets = path.join(root, 'assets');
  const output = path.join(root, 'out');
  mkdirSync(assets);
  const platforms = {};
  for (const [platform, name] of Object.entries({
    'windows-x86_64': 'LynShen_1.2.3_x64-setup.exe',
    'darwin-aarch64': 'LynShen_aarch64.app.tar.gz',
    'darwin-x86_64': 'LynShen_x64.app.tar.gz',
  })) {
    writeFileSync(path.join(assets, name), 'binary');
    writeFileSync(path.join(assets, name + '.sig'), 'signature\n');
    platforms[platform] = { url: `https://github.com/example/releases/download/v1.2.3/${name}`, signature: 'signature' };
  }
  for (const arch of ['aarch64', 'x64']) writeFileSync(path.join(assets, `LynShen_1.2.3_${arch}.dmg`), 'installer');
  const manifest = { version: '1.2.3', platforms };
  const save = () => writeFileSync(path.join(assets, 'latest.json'), JSON.stringify(manifest));
  save();
  try { run({ assets, output, manifest, save }); } finally { rmSync(root, { recursive: true }); }
}
test('rewrites every artifact to the LynShen host and preserves signatures', () => fixture(({ assets, output }) => {
  const catalog = prepareRelease(assets, output, 'https://www.lynshen.org');
  assert.equal(Object.keys(catalog.platforms).length, 3);
  const manifest = JSON.parse(readFileSync(path.join(output, 'latest.json')));
  for (const entry of Object.values(manifest.platforms)) {
    assert.match(entry.url, /^https:\/\/www\.lynshen\.org\/v1\/public\/releases\/desktop\/1\.2\.3\//);
    assert.equal(entry.signature, 'signature');
  }
  assert.match(catalog.platforms['windows-x86_64'].sha256, /^[a-f0-9]{64}$/);
}));
test('rejects incomplete releases before writing manifests', () => fixture(({ assets, output, manifest, save }) => {
  delete manifest.platforms['darwin-x86_64']; save();
  assert.throws(() => prepareRelease(assets, output, 'https://www.lynshen.org'), /Missing signed/);
}));
test('rejects changed signatures and unsafe artifact paths', () => fixture(({ assets, output, manifest, save }) => {
  manifest.platforms['windows-x86_64'].signature = 'different'; save();
  assert.throws(() => prepareRelease(assets, output, 'https://www.lynshen.org'), /Signature mismatch/);
  manifest.platforms['windows-x86_64'].url = 'https://example.com/a%2Fb'; save();
  assert.throws(() => prepareRelease(assets, output, 'https://www.lynshen.org'));
  assert.throws(() => prepareRelease(assets, output, 'http://www.lynshen.org'), /HTTPS/);
}));
test('offers the Linux installers when the release carries them', () => fixture(({ assets, output, manifest, save }) => {
  for (const [platform, name] of Object.entries({
    'linux-x86_64-appimage': 'LynShen_1.2.3_amd64.AppImage',
    'linux-x86_64-deb': 'LynShen_1.2.3_amd64.deb',
    'linux-x86_64-rpm': 'LynShen-1.2.3-1.x86_64.rpm',
  })) {
    writeFileSync(path.join(assets, name), 'linux');
    writeFileSync(path.join(assets, name + '.sig'), 'signature\n');
    manifest.platforms[platform] = { url: `https://github.com/example/releases/download/v1.2.3/${name}`, signature: 'signature' };
  }
  save();
  const catalog = prepareRelease(assets, output, 'https://www.lynshen.org');
  assert.deepEqual(Object.keys(catalog.platforms), ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64', 'linux-x86_64-appimage', 'linux-x86_64-deb', 'linux-x86_64-rpm']);
  assert.equal(catalog.platforms['linux-x86_64-rpm'].url, '/v1/public/releases/desktop/1.2.3/LynShen-1.2.3-1.x86_64.rpm');
  assert.match(catalog.platforms['linux-x86_64-appimage'].sha256, /^[a-f0-9]{64}$/);
}));
test('leaves Linux out of the catalog when the release has none', () => fixture(({ assets, output }) => {
  assert.equal('linux-x86_64-deb' in prepareRelease(assets, output, 'https://www.lynshen.org').platforms, false);
}));
test('takes a release under the product name Aogiri, as tauri-action names its files', () => {
  // The product was LynShen up to 0.5.x; the release scripts and the server
  // copy of the receiver know no product name. Every file a full release
  // carries, named as in v0.5.0 with the new prefix.
  const root = mkdtempSync(path.join(tmpdir(), 'desktop-release-'));
  try {
    const assets = path.join(root, 'assets');
    const output = path.join(root, 'out');
    mkdirSync(assets);
    const files = {
      'windows-x86_64': 'Aogiri_1.2.3_x64_en-US.msi',
      'windows-x86_64-msi': 'Aogiri_1.2.3_x64_en-US.msi',
      'windows-x86_64-nsis': 'Aogiri_1.2.3_x64-setup.exe',
      'darwin-aarch64': 'Aogiri_aarch64.app.tar.gz',
      'darwin-aarch64-app': 'Aogiri_aarch64.app.tar.gz',
      'darwin-x86_64': 'Aogiri_x64.app.tar.gz',
      'darwin-x86_64-app': 'Aogiri_x64.app.tar.gz',
      'linux-x86_64': 'Aogiri_1.2.3_amd64.AppImage',
      'linux-x86_64-appimage': 'Aogiri_1.2.3_amd64.AppImage',
      'linux-x86_64-deb': 'Aogiri_1.2.3_amd64.deb',
      'linux-x86_64-rpm': 'Aogiri-1.2.3-1.x86_64.rpm',
    };
    const platforms = {};
    for (const [platform, name] of Object.entries(files)) {
      writeFileSync(path.join(assets, name), name);
      writeFileSync(path.join(assets, name + '.sig'), 'signature\n');
      platforms[platform] = { url: `https://github.com/Libra1337/LynShen_Agent/releases/download/v1.2.3/${name}`, signature: 'signature' };
    }
    for (const arch of ['aarch64', 'x64']) writeFileSync(path.join(assets, `Aogiri_1.2.3_${arch}.dmg`), arch);
    writeFileSync(path.join(assets, 'latest.json'), JSON.stringify({ version: '1.2.3', platforms }));
    const catalog = prepareRelease(assets, output, 'https://www.lynshen.org');
    assert.deepEqual(Object.fromEntries(Object.entries(catalog.platforms).map(([k, v]) => [k, v.url.split('/').at(-1)])), {
      'windows-x86_64': 'Aogiri_1.2.3_x64-setup.exe',
      'darwin-aarch64': 'Aogiri_1.2.3_aarch64.dmg',
      'darwin-x86_64': 'Aogiri_1.2.3_x64.dmg',
      'linux-x86_64-appimage': 'Aogiri_1.2.3_amd64.AppImage',
      'linux-x86_64-deb': 'Aogiri_1.2.3_amd64.deb',
      'linux-x86_64-rpm': 'Aogiri-1.2.3-1.x86_64.rpm',
    });
    const manifest = JSON.parse(readFileSync(path.join(output, 'latest.json')));
    assert.equal(manifest.platforms['windows-x86_64-nsis'].url, 'https://www.lynshen.org/v1/public/releases/desktop/1.2.3/Aogiri_1.2.3_x64-setup.exe');
    assert.equal(manifest.platforms['darwin-aarch64'].url, 'https://www.lynshen.org/v1/public/releases/desktop/1.2.3/Aogiri_aarch64.app.tar.gz');
  } finally {
    rmSync(root, { recursive: true });
  }
});
