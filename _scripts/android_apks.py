"""Validate, name and report the APKs produced by Gradle's ABI splits."""

import argparse
import io
import json
from pathlib import Path
import re
import shutil
import struct
import zipfile

ABIS = {"arm64-v8a", "armeabi-v7a", "x86", "x86_64"}
MIB = 1024 * 1024
# Android provides these at runtime; every other dependency must be packaged.
SYSTEM_LIBRARIES = {"libc.so", "libdl.so", "liblog.so", "libm.so"}


def elf_needed(data):
    """Return an ELF file's DT_NEEDED entries, or None for other files."""
    if data[:4] != b"\x7fELF":
        return None
    wide, order = data[4] == 2, "<" if data[5] == 1 else ">"
    if wide:
        offset, = struct.unpack_from(order + "Q", data, 0x20)
        size, count = struct.unpack_from(order + "HH", data, 0x36)
        program, dynamic = "IIQQQQ", "qQ"
    else:
        offset, = struct.unpack_from(order + "I", data, 0x1C)
        size, count = struct.unpack_from(order + "HH", data, 0x2A)
        program, dynamic = "IIIII", "iI"
    loads, entries = [], []
    for index in range(count):
        values = struct.unpack_from(order + program, data, offset + index * size)
        kind, (file_offset, address, _, length) = values[0], values[2:6] if wide else values[1:5]
        if kind == 1:
            loads.append((address, file_offset, length))
        elif kind == 2:
            step = struct.calcsize(order + dynamic)
            entries = [struct.unpack_from(order + dynamic, data, file_offset + start)
                       for start in range(0, length, step)]
    table = next((value for tag, value in entries if tag == 5), None)
    if table is None:
        return []
    table = next(file_offset + table - address for address, file_offset, length in loads
                 if address <= table < address + length)
    return [data[table + value:data.index(b"\0", table + value)].decode()
            for tag, value in entries if tag == 1]


def check_dependencies(apk, arch):
    """Ensure pruning the runtimes left every loaded library resolvable."""
    files = {}
    for name in ("python", "qjs", "ffmpeg", "ffprobe"):
        files[f"lib{name}.so"] = apk.read(f"lib/{arch}/lib{name}.so")
    roots = list(files)
    for runtime in ("python", "ffmpeg"):
        with zipfile.ZipFile(io.BytesIO(apk.read(f"lib/{arch}/lib{runtime}.zip.so"))) as archive:
            for entry in archive.infolist():
                name = entry.filename
                if entry.is_dir() or not name.startswith("usr/lib/"):
                    continue
                target = entry
                while (target.external_attr >> 16) & 0o170000 == 0o120000:
                    link = (Path(target.filename).parent / archive.read(target).decode()).as_posix()
                    try:
                        target = archive.getinfo(link)
                    except KeyError:
                        raise ValueError(f"{arch}: {runtime} runtime has a dangling symlink: {name}") from None
                data = archive.read(target)
                if "/" not in name[len("usr/lib/"):]:
                    # LD_LIBRARY_PATH lists Python's libraries before FFmpeg's.
                    files.setdefault(Path(name).name, data)
                elif name.endswith(".so"):
                    # Python loads extension modules on import.
                    roots.append(name)
                    files[name] = data
    pending, seen = roots, set(roots)
    while pending:
        name = pending.pop()
        for dependency in elf_needed(files[name]) or []:
            if dependency in SYSTEM_LIBRARIES or dependency in seen:
                continue
            if dependency not in files:
                raise ValueError(f"{arch}: {name} needs {dependency}, which is not packaged")
            seen.add(dependency)
            pending.append(dependency)


def inspect_apk(path, abi):
    sizes = dict(native=0, dex=0, web=0, other=0)
    with zipfile.ZipFile(path) as apk:
        if apk.testzip() is not None:
            raise ValueError(f"Corrupt APK: {path}")
        native_abis = {name.split("/")[1] for name in apk.namelist() if name.startswith("lib/")}
        expected = ABIS if abi == "universal" else {abi}
        if native_abis != expected:
            raise ValueError(f"{path}: expected architectures {expected}, found {native_abis}")
        for arch in expected:
            for executable in ("python", "qjs", "ffmpeg", "ffprobe"):
                apk.getinfo(f"lib/{arch}/lib{executable}.so")
            for runtime in ("python", "ffmpeg"):
                with zipfile.ZipFile(io.BytesIO(apk.read(f"lib/{arch}/lib{runtime}.zip.so"))) as archive:
                    if archive.testzip() is not None:
                        raise ValueError(f"Corrupt {runtime} runtime: {path}")
                    if "usr/lib/quickjs/libquickjs.a" in archive.namelist():
                        raise ValueError(f"{path}: build-only QuickJS static library is packaged")
            check_dependencies(apk, arch)
        for entry in apk.infolist():
            name = entry.filename
            category = (
                "native" if name.startswith("lib/") else
                "dex" if name.endswith(".dex") else
                "web" if name.startswith("assets/public/") else "other"
            )
            sizes[category] += entry.compress_size
    sizes["other"] += path.stat().st_size - sum(sizes.values())
    return sizes


def prepare(source, destination, *, release=False, max_abi_mib=75, max_universal_mib=225):
    metadata = json.loads((source / "output-metadata.json").read_text())
    package = "org.opentubex.app" + ("" if release else ".nightly")
    if metadata["applicationId"] != package:
        raise ValueError(f"Expected package {package}, found {metadata['applicationId']}")
    apks = {}
    versions = set()
    for element in metadata["elements"]:
        filters = element["filters"]
        if not filters:
            abi = "universal"
        elif len(filters) == 1 and filters[0]["filterType"] == "ABI":
            abi = filters[0]["value"]
        else:
            raise ValueError(f"Unexpected APK filters: {filters}")
        if abi in apks:
            raise ValueError(f"Duplicate APK for {abi}")
        name = element["outputFile"]
        if Path(name).name != name or not name.endswith(".apk"):
            raise ValueError(f"Invalid APK filename: {name}")
        versions.add(element["versionName"])
        apks[abi] = source / name
    if set(apks) != ABIS | {"universal"}:
        raise ValueError("Expected four architecture APKs and one universal APK")
    if len(versions) != 1:
        raise ValueError("APK versions do not match")
    version = versions.pop()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError(f"Invalid APK version: {version}")

    rows = []
    for abi, path in sorted(apks.items()):
        sizes = inspect_apk(path, abi)
        limit = max_universal_mib if abi == "universal" else max_abi_mib
        total = sum(sizes.values()) / MIB
        if total > limit:
            raise ValueError(f"{path.name}: {total:.2f} MiB exceeds the {limit} MiB size budget")
        if release:
            # Keep the universal APK without an architecture suffix.
            suffix = "" if abi == "universal" else f"-{abi}"
            name = f"org.opentubex.app-{version}-beta{suffix}.apk"
        else:
            name = f"opentubex-{version}-android-{abi}.apk"
        rows.append((path, name, sizes, total))

    # Validate the whole set before making anything available for publication.
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError(f"Output directory must be empty: {destination}")
    report = ["| APK | Total MiB | Native | DEX | Web | Other |",
              "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for path, name, sizes, total in rows:
        shutil.copyfile(path, destination / name)
        values = " | ".join(f"{size / MIB:.2f}" for size in sizes.values())
        report.append(f"| {name} | {total:.2f} | {values} |")
    return "\n".join(report) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--release", action="store_true")
    parser.add_argument("--max-abi-mib", type=float, default=75)
    parser.add_argument("--max-universal-mib", type=float, default=225)
    args = parser.parse_args()
    print(prepare(**vars(args)), end="")
