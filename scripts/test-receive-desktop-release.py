import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).with_name('receive-desktop-release.py'))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class ReceiverTests(unittest.TestCase):
    def rejected(self, name, kind=tarfile.REGTYPE):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w:gz') as archive:
            member = tarfile.TarInfo(name)
            member.type = kind
            member.linkname = '/etc/passwd'
            archive.addfile(member, io.BytesIO())
        data.seek(0)
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                receiver.receive(data, root)
            self.assertEqual(list(Path(root).iterdir()), [])

    def test_traversal_and_absolute_paths(self):
        for name in ('../escape', '/etc/passwd', '1.2.3/../../escape', '1.2.3/a/b'):
            with self.subTest(name=name):
                self.rejected(name)

    def test_links_are_never_extracted(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
            self.rejected('1.2.3/file.exe', kind)

    @unittest.skipUnless(hasattr(hashlib, 'file_digest'), 'the receiver needs Python 3.11 (hashlib.file_digest), as on the server')
    def test_release_under_the_new_product_name(self):
        # Up to 0.5.x the files were LynShen_*; the receiver knows no product
        # name, so a release of Aogiri_* files goes through unchanged.
        version = '1.2.3'
        updaters = {
            'windows-x86_64-nsis': 'Aogiri_1.2.3_x64-setup.exe',
            'windows-x86_64-msi': 'Aogiri_1.2.3_x64_en-US.msi',
            'darwin-aarch64': 'Aogiri_aarch64.app.tar.gz',
            'linux-x86_64-deb': 'Aogiri_1.2.3_amd64.deb',
        }
        files = {f'{version}/{name}': name.encode() for name in updaters.values()}
        files.update({f'{version}/{name}.sig': b'signature\n' for name in updaters.values()})
        files[f'{version}/Aogiri_1.2.3_aarch64.dmg'] = b'dmg'
        base = f'https://www.lynshen.org/v1/public/releases/desktop/{version}/'
        latest = {'version': version, 'platforms': {
            key: {'url': base + name, 'signature': 'signature'} for key, name in updaters.items()}}
        installers = {'windows-x86_64-nsis': 'Aogiri_1.2.3_x64-setup.exe', 'darwin-aarch64': 'Aogiri_1.2.3_aarch64.dmg'}
        catalog = {'version': version, 'platforms': {
            key: {'url': f'/v1/public/releases/desktop/{version}/{name}',
                  'sha256': hashlib.sha256(files[f'{version}/{name}']).hexdigest()}
            for key, name in installers.items()}}
        files['latest.json'] = json.dumps(latest).encode()
        files['catalog.json'] = json.dumps(catalog).encode()
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w:gz') as archive:
            folder = tarfile.TarInfo(version)
            folder.type = tarfile.DIRTYPE
            archive.addfile(folder)
            for name, content in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
        data.seek(0)
        with tempfile.TemporaryDirectory() as root:
            receiver.receive(data, root)
            published = sorted(p.name for p in (Path(root) / version).iterdir())
            self.assertIn('Aogiri_1.2.3_x64-setup.exe', published)
            self.assertIn('Aogiri_aarch64.app.tar.gz.sig', published)
            self.assertEqual(json.loads((Path(root) / 'latest.json').read_text())['version'], version)


if __name__ == '__main__':
    unittest.main()
