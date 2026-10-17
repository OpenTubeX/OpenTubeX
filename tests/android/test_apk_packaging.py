import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location(
    "android_apks", Path(__file__).resolve().parents[2] / "_scripts/android_apks.py"
)
apks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apks)


def elf(*needed):
    """Build a minimal 64-bit ELF file that links the given libraries."""
    strings, offsets = b"\0", []
    for name in needed:
        offsets.append(len(strings))
        strings += name.encode() + b"\0"
    table = 64 + 2 * 56
    dynamic = b"".join(struct.pack("<qQ", tag, value)
                       for tag, value in [(1, offset) for offset in offsets] + [(5, table), (0, 0)])
    size = table + len(strings) + len(dynamic)
    return (b"\x7fELF\x02\x01\x01" + bytes(9)
            + struct.pack("<HHIQQQIHHHHHH", 3, 183, 1, 0, 64, 0, 0, 64, 56, 2, 0, 0, 0)
            + struct.pack("<IIQQQQQQ", 1, 4, 0, 0, 0, size, size, 0x1000)
            + struct.pack("<IIQQQQQQ", 2, 4, table + len(strings), table + len(strings), 0,
                          len(dynamic), len(dynamic), 8)
            + strings + dynamic)


def symlink(name, target):
    info = zipfile.ZipInfo(name)
    info.create_system = 3
    info.external_attr = 0o120777 << 16
    return info, target


class ApkPackagingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "source"
        self.output = Path(self.temp.name) / "output"
        self.source.mkdir()
        self.metadata = dict(applicationId="org.opentubex.app.nightly", elements=[])
        for abi in sorted(apks.ABIS | {"universal"}):
            name = f"app-{abi}-nightly.apk"
            self.metadata["elements"].append(dict(
                filters=[] if abi == "universal" else [dict(filterType="ABI", value=abi)],
                versionName="0.34.0-nightly-1234", outputFile=name,
            ))
            self.write_apk(name, apks.ABIS if abi == "universal" else {abi})
        self.write_metadata()

    def write_metadata(self):
        (self.source / "output-metadata.json").write_text(json.dumps(self.metadata))

    def write_apk(self, name, abis, build_only=False, ffmpeg=b"fixture", python_files=(), ffmpeg_files=()):
        def runtime(files):
            data = io.BytesIO()
            with zipfile.ZipFile(data, "w") as archive:
                archive.writestr("usr/lib/runtime.so", b"fixture")
                if build_only:
                    archive.writestr("usr/lib/quickjs/libquickjs.a", b"build-only")
                for entry, content in files:
                    archive.writestr(entry, content)
            return data.getvalue()

        with zipfile.ZipFile(self.source / name, "w") as apk:
            apk.writestr("classes.dex", b"fixture")
            for abi in abis:
                for executable in ("python", "qjs", "ffprobe"):
                    apk.writestr(f"lib/{abi}/lib{executable}.so", b"fixture")
                apk.writestr(f"lib/{abi}/libffmpeg.so", ffmpeg)
                apk.writestr(f"lib/{abi}/libpython.zip.so", runtime(python_files))
                apk.writestr(f"lib/{abi}/libffmpeg.zip.so", runtime(ffmpeg_files))

    def test_names_and_reports_all_nightly_apks(self):
        report = apks.prepare(self.source, self.output)
        self.assertEqual(len(list(self.output.glob("*.apk"))), 5)
        for abi in apks.ABIS | {"universal"}:
            self.assertIn(f"opentubex-0.34.0-nightly-1234-android-{abi}.apk", report)

    def test_names_release_apks_beta(self):
        self.metadata["applicationId"] = "org.opentubex.app"
        for element in self.metadata["elements"]:
            element["versionName"] = "0.34.0"
        self.write_metadata()
        apks.prepare(self.source, self.output, release=True)
        self.assertTrue((self.output / "org.opentubex.app-0.34.0-beta.apk").exists())
        self.assertTrue((self.output / "org.opentubex.app-0.34.0-beta-arm64-v8a.apk").exists())

    def test_rejects_incomplete_set_before_copying(self):
        self.metadata["elements"].pop()
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "Expected four"):
            apks.prepare(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_rejects_universal_payload_mislabeled_as_arm64(self):
        self.write_apk("app-arm64-v8a-nightly.apk", apks.ABIS)
        with self.assertRaisesRegex(ValueError, "expected architectures"):
            apks.prepare(self.source, self.output)

    def test_rejects_build_only_runtime_files(self):
        self.write_apk("app-arm64-v8a-nightly.apk", {"arm64-v8a"}, build_only=True)
        with self.assertRaisesRegex(ValueError, "build-only"):
            apks.prepare(self.source, self.output)

    def test_resolves_runtime_libraries_through_symlinks_in_either_runtime(self):
        self.write_apk("app-arm64-v8a-nightly.apk", {"arm64-v8a"}, ffmpeg=elf("libavcodec.so.61", "libc.so"),
                       python_files=[("usr/lib/libz.so.1.3.1", elf()), symlink("usr/lib/libz.so.1", "libz.so.1.3.1")],
                       ffmpeg_files=[("usr/lib/libavcodec.so.61.19.101", elf("libz.so.1")),
                                     symlink("usr/lib/libavcodec.so.61", "libavcodec.so.61.19.101")])
        apks.prepare(self.source, self.output)
        self.assertEqual(len(list(self.output.glob("*.apk"))), 5)

    def test_rejects_runtime_without_a_linked_library(self):
        self.write_apk("app-arm64-v8a-nightly.apk", {"arm64-v8a"}, ffmpeg=elf("libavcodec.so.61"),
                       ffmpeg_files=[("usr/lib/libavcodec.so.61", elf("libx264.so.164"))])
        with self.assertRaisesRegex(ValueError, "libavcodec.so.61 needs libx264.so.164"):
            apks.prepare(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_rejects_python_module_without_a_linked_library(self):
        self.write_apk("app-arm64-v8a-nightly.apk", {"arm64-v8a"},
                       python_files=[("usr/lib/python3.12/lib-dynload/_ssl.cpython-312.so", elf("libssl.so.3"))])
        with self.assertRaisesRegex(ValueError, "_ssl.cpython-312.so needs libssl.so.3"):
            apks.prepare(self.source, self.output)

    def test_rejects_dangling_runtime_symlinks(self):
        self.write_apk("app-arm64-v8a-nightly.apk", {"arm64-v8a"},
                       ffmpeg_files=[symlink("usr/lib/libz.so.1", "libz.so.1.3.1")])
        with self.assertRaisesRegex(ValueError, "dangling symlink: usr/lib/libz.so.1"):
            apks.prepare(self.source, self.output)

    def test_enforces_download_size_budget(self):
        with self.assertRaisesRegex(ValueError, "size budget"):
            apks.prepare(self.source, self.output, max_abi_mib=0.001)
        self.assertFalse(self.output.exists())

    def test_accepts_universal_apk_with_bundled_sqlite(self):
        inspect = apks.inspect_apk

        def inspect_with_sqlite(path, abi):
            sizes = inspect(path, abi)
            if abi == "universal":
                # Size observed in the first nightly with bundled SQLite.
                sizes["native"] += round(217.61 * apks.MIB) - sum(sizes.values())
            return sizes

        with patch.object(apks, "inspect_apk", side_effect=inspect_with_sqlite):
            report = apks.prepare(self.source, self.output)

        self.assertIn("217.61", report)
        self.assertEqual(len(list(self.output.glob("*.apk"))), 5)

    def test_enforces_universal_download_size_budget(self):
        inspect = apks.inspect_apk

        def inspect_oversized_universal(path, abi):
            sizes = inspect(path, abi)
            if abi == "universal":
                sizes["native"] += round(225.01 * apks.MIB) - sum(sizes.values())
            return sizes

        with patch.object(apks, "inspect_apk", side_effect=inspect_oversized_universal):
            with self.assertRaisesRegex(ValueError, "225.01 MiB exceeds the 225 MiB size budget"):
                apks.prepare(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_rejects_nightly_package_in_release_upload(self):
        with self.assertRaisesRegex(ValueError, "Expected package"):
            apks.prepare(self.source, self.output, release=True)

    def test_rejects_stale_output_files(self):
        self.output.mkdir()
        (self.output / "stale.apk").touch()
        with self.assertRaisesRegex(ValueError, "must be empty"):
            apks.prepare(self.source, self.output)


if __name__ == "__main__":
    unittest.main()
