#!/usr/bin/env python3
"""Offline native Copilot component deployment, using only Python's stdlib."""

from __future__ import annotations

import hashlib
import json
import os
import posixpath
import re
import stat
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

sys.dont_write_bytecode = True

ROOT = Path(os.path.abspath(__file__)).parents[3]
MANIFEST = "skills/ps-version/version-manifest.json"
RECEIPT = ".ps/deployment.json"
GUIDES = (
    "README.md",
    "docs/setup.md",
    "docs/data-contract.md",
    "docs/development.md",
    "docs/managing-a-datasource.md",
    "docs/how-to-use-product-scout.md",
)
ARTIFACT_GROUPS = ("skills", "automations", "extensions", "agents")
EXTENSIONS = {".json", ".mjs", ".js", ".py", ".html", ".css", ".svg", ".md"}
PathLike = Union[str, Path]


def semver(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(
        r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value
    ) is not None


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def safe_path(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not value
        or not re.fullmatch(r"[a-zA-Z0-9_./-]+", value)
        or any(
            not part or part.startswith(".") or part in {"node_modules", "__pycache__"}
            for part in value.split("/")
        )
    ):
        raise ValueError("Unsafe managed path: " + repr(value))
    return value


def allowed_destination(value: str) -> None:
    safe_path(value)
    if posixpath.splitext(value)[1] not in EXTENSIONS or not re.fullmatch(
        r"(skills/ps(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?/.+"
        r"|extensions/ps-[a-z0-9]+(?:-[a-z0-9]+)*/.+"
        r"|agents/ps-[a-z0-9]+(?:-[a-z0-9]+)*\.agent\.md)", value
    ):
        raise ValueError("File outside component destinations: " + value)


def file_stat(file: PathLike) -> Optional[os.stat_result]:
    try:
        return os.lstat(file)
    except FileNotFoundError:
        return None


def no_symlink(file: PathLike) -> None:
    # Inspect raw components before abspath can collapse a symlink followed by "..".
    raw = os.fspath(file)
    if not os.path.isabs(raw):
        raw = os.path.join(os.getcwd(), raw)
    parts = raw.split(os.sep)
    current = os.sep
    for index, part in enumerate(parts):
        if not part:
            continue
        current = os.path.join(current, part)
        info = file_stat(current)
        if info is not None and stat.S_ISLNK(info.st_mode):
            raise ValueError("Symlink is not allowed: " + current)
        if info is not None and index < len(parts) - 1 and not stat.S_ISDIR(info.st_mode):
            raise ValueError("Not a directory: " + current)


def read_bytes(file: PathLike) -> bytes:
    no_symlink(file)
    info = file_stat(file)
    if info is None:
        raise ValueError("Missing release file: " + os.fspath(file))
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Not a regular release file: " + os.fspath(file))
    return Path(file).read_bytes()


def unique_object(pairs: List[Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def read_json(file: PathLike) -> Dict[str, Any]:
    value = json.loads(read_bytes(file), object_pairs_hook=unique_object)
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object: " + os.fspath(file))
    return value


def valid_versions(value: Any) -> bool:
    if not isinstance(value, dict) or not semver(value.get("runtimeVersion")):
        return False
    for group in ARTIFACT_GROUPS:
        entries = value.get(group)
        if not isinstance(entries, dict):
            return False
        for name, version in entries.items():
            if not isinstance(name, str) or not (
                (group == "skills" and name == "ps")
                or re.fullmatch(r"ps-[a-z0-9]+(?:-[a-z0-9]+)*", name)
            ) or not semver(version):
                return False
    return True


def versions(manifest: Dict[str, Any]) -> Dict[str, Any]:
    return {key: manifest[key] for key in ("runtimeVersion",) + ARTIFACT_GROUPS}


def version_changes(previous: Optional[Dict[str, Any]], current: Dict[str, Any]) -> List[Dict[str, Any]]:
    def flatten(value: Optional[Dict[str, Any]]) -> Dict[str, str]:
        if value is None:
            return {}
        result = {"runtime": value["runtimeVersion"]}
        for group in ARTIFACT_GROUPS:
            result.update({group + "/" + name: version for name, version in value[group].items()})
        return result

    before, after = flatten(previous), flatten(current)
    return [
        {"name": name, "from": before.get(name), "to": after.get(name)}
        for name in sorted(before.keys() | after.keys())
        if before.get(name) != after.get(name)
    ]


def read_manifest(source: PathLike) -> Dict[str, Any]:
    no_symlink(source)
    manifest = read_json(Path(source) / MANIFEST)
    if (
        manifest.get("schemaVersion") != "2.0"
        or manifest.get("namespace") != "ps"
        or not semver(manifest.get("version"))
        or not valid_versions(manifest)
        or "managed" in manifest
        or "components" in manifest
    ):
        raise ValueError("Invalid Product Scout version manifest: schema 2.0 requires independently named artifact versions and no managed or components")
    if not {"ps-update", "ps-version"}.issubset(manifest["skills"]):
        raise ValueError("Manifest must declare skills ps-update and ps-version")
    if manifest["automations"] and "ps-data-refresh" not in manifest["skills"]:
        raise ValueError("Automation packaging requires skill ps-data-refresh")
    return manifest


def inventory(source: PathLike, manifest: Dict[str, Any]) -> Dict[str, bytes]:
    no_symlink(source)
    source = Path(source)
    files: Dict[str, bytes] = {}

    def visit(relative: str, directory: Optional[bool] = None) -> None:
        safe_path(relative)
        file = source / relative
        no_symlink(file)
        info = file_stat(file)
        if info is None:
            raise ValueError("Missing release entry: " + relative)
        is_directory = stat.S_ISDIR(info.st_mode)
        if directory is True and not is_directory:
            raise ValueError("Expected release directory: " + relative)
        if directory is False and not stat.S_ISREG(info.st_mode):
            raise ValueError("Expected regular release file: " + relative)
        if is_directory:
            for name in sorted(os.listdir(file)):
                visit(relative + "/" + name)
        elif stat.S_ISREG(info.st_mode):
            if posixpath.splitext(relative)[1] not in EXTENSIONS:
                raise ValueError("File outside managed release allowlist: " + relative)
            files[relative] = read_bytes(file)
        else:
            raise ValueError("Not a regular release file: " + relative)

    # Named roots only: never enumerate broad categories, tests, or neighbors.
    for group in ARTIFACT_GROUPS:
        for name in sorted(manifest[group]):
            relative = group + "/" + name + (".agent.md" if group == "agents" else "")
            count = len(files)
            visit(relative, directory=group != "agents")
            if count == len(files):
                raise ValueError("Empty release artifact: " + relative)
    for guide in GUIDES:
        visit(guide, directory=False)
    return files


def destination_for(relative: str) -> Optional[str]:
    if re.match(r"^(skills|extensions|agents)(/|$)", relative):
        return relative
    if relative == "README.md" or relative == "docs" or relative.startswith("docs/"):
        return "skills/ps-update/references/" + relative
    if relative == "automations" or relative.startswith("automations/"):
        return "skills/ps-data-refresh/references/" + re.sub(r"/SKILL\.md$", "/automation.md", relative)
    return None


def deployment_files(source_files: Dict[str, bytes]) -> Dict[str, bytes]:
    files: Dict[str, bytes] = {}
    for source_path, content in source_files.items():
        destination = destination_for(source_path)
        if destination is None:
            continue
        allowed_destination(destination)
        if destination in files:
            raise ValueError("Duplicate component destination: " + destination)
        if source_path.endswith(".md"):
            def rewrite(match: re.Match[str]) -> str:
                prefix, link, suffix = match.groups()
                if re.match(r"^[a-z][a-z0-9+.-]*:|^#", link, re.I):
                    return match.group(0)
                pieces = link.split("#")
                target = pieces[0]
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source_path), target))
                mapped = destination_for(resolved)
                if mapped is None:
                    return match.group(0)
                rewritten = posixpath.relpath(mapped, posixpath.dirname(destination))
                return prefix + rewritten + ("#" + pieces[1] if len(pieces) > 1 else "") + suffix

            content = re.sub(r"(\[[^\]]+\]\()([^)]+)(\))", rewrite, content.decode("utf-8", errors="replace")).encode("utf-8")
        files[destination] = content
    return files


def read_receipt(destination: PathLike) -> Optional[Dict[str, Any]]:
    file = Path(destination) / RECEIPT
    no_symlink(file)
    if file_stat(file) is None:
        return None
    receipt = read_json(file)
    if (
        receipt.get("schemaVersion") != "2.0"
        or receipt.get("namespace") != "ps"
        or not semver(receipt.get("version"))
        or not isinstance(receipt.get("files"), dict)
    ):
        raise ValueError("Invalid installation receipt")
    if "versions" in receipt and not valid_versions(receipt["versions"]):
        raise ValueError("Invalid installation artifact versions")
    for name, value in receipt["files"].items():
        allowed_destination(name)
        if not isinstance(value, str) or re.fullmatch(r"[a-f0-9]{64}", value) is None:
            raise ValueError("Invalid installation hash")
    return receipt


def plan(source: PathLike, host_root: PathLike) -> Dict[str, Any]:
    no_symlink(source)
    no_symlink(host_root)
    source, destination = Path(os.path.abspath(source)), Path(os.path.abspath(host_root))
    if os.path.commonpath((source, destination)) in (str(source), str(destination)):
        raise ValueError("Source and Copilot component directory must not overlap")
    manifest = read_manifest(source)
    files = deployment_files(inventory(source, manifest))
    previous = read_receipt(destination)
    previous_files = previous["files"] if previous else {}
    changes, conflicts = [], []
    for name in sorted(files.keys() | previous_files.keys()):
        file = destination / name
        no_symlink(file)
        info = file_stat(file)
        existing = read_bytes(file) if info and stat.S_ISREG(info.st_mode) else None
        old_hash = previous_files.get(name)
        if info and not stat.S_ISREG(info.st_mode):
            conflicts.append(name + ": destination is not a file")
        elif old_hash and (existing is None or digest(existing) != old_hash):
            conflicts.append(name + ": locally modified or deleted")
        elif not old_hash and info:
            conflicts.append(name + ": unmanaged file collision")
        elif name not in files:
            changes.append({"path": name, "action": "remove"})
        elif existing is None:
            changes.append({"path": name, "action": "add"})
        elif digest(existing) != digest(files[name]):
            changes.append({"path": name, "action": "update"})
    return dict(source=source, destination=destination, manifest=manifest, files=files,
                previous=previous, changes=changes, conflicts=conflicts)


def make_directory(directory: Path) -> None:
    no_symlink(directory)
    if file_stat(directory) is not None:
        if not directory.is_dir():
            raise ValueError("Not a directory: " + str(directory))
        return
    make_directory(directory.parent)
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        no_symlink(directory)
        if not directory.is_dir():
            raise ValueError("Not a directory: " + str(directory))


def atomic_write(file: PathLike, content: bytes) -> None:
    no_symlink(file)
    file = Path(file)
    make_directory(file.parent)
    staging = file.with_name(file.name + ".ps-" + str(uuid.uuid4()))
    owned = False
    try:
        descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        owned = True
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        no_symlink(file)
        os.replace(staging, file)
    finally:
        if owned and file_stat(staging) is not None:
            staging.unlink()


def json_bytes(value: Any) -> bytes:
    return json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False).encode("utf-8")


def install(source: PathLike, host_root: Optional[PathLike] = None, apply: bool = False) -> Dict[str, Any]:
    if not source:
        raise ValueError("--source is required for component deployment")
    if host_root is None:
        host_root = Path.home() / ".copilot"
    if not os.path.isabs(host_root) or Path(host_root).name not in {".copilot", ".github"}:
        raise ValueError("--host-root must be an absolute .copilot or .github component directory")
    prepared = plan(source, host_root)
    report = {
        "schemaVersion": "2.0", "namespace": "ps", "version": prepared["manifest"]["version"],
        "versions": versions(prepared["manifest"]),
        "versionChanges": version_changes(
            prepared["previous"].get("versions") if prepared["previous"] else None,
            versions(prepared["manifest"])),
        "command": "install", "applied": False, "destination": str(prepared["destination"]),
        "changes": prepared["changes"], "conflicts": prepared["conflicts"], "backup": None,
    }
    if not apply or report["conflicts"]:
        return report
    destination = prepared["destination"]
    state_directory = destination / ".ps"
    no_symlink(state_directory)
    make_directory(state_directory)
    lock = state_directory / "deploy.lock"
    no_symlink(lock)
    descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    identity = os.fstat(descriptor)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write((str(os.getpid()) + "\n").encode("ascii"))
        writer_lock = state_directory / "writer.lock"
        no_symlink(writer_lock)
        if file_stat(writer_lock) is not None:
            raise ValueError("Stop the Product Scout runtime before deploying components; its writer lock is active.")
        for runtime_lock in state_directory.glob("runtime-*.lock"):
            no_symlink(runtime_lock)
            owner = read_bytes(runtime_lock).decode("ascii").strip()
            if not owner.isdigit() or int(owner) <= 0:
                raise ValueError("Invalid Product Scout runtime lease; inspect it before deploying.")
            try:
                os.kill(int(owner), 0)
            except ProcessLookupError:
                continue
            except (PermissionError, OverflowError) as error:
                raise ValueError("Cannot verify Product Scout runtime owner; stop it before deploying.") from error
            raise ValueError("Stop all Product Scout sessions before deploying components; a runtime is active.")
        prepared = plan(source, host_root)
        previous, files, changes = prepared["previous"], prepared["files"], prepared["changes"]
        report.update(changes=changes, conflicts=prepared["conflicts"],
                      version=prepared["manifest"]["version"], versions=versions(prepared["manifest"]))
        report["versionChanges"] = version_changes(previous.get("versions") if previous else None, report["versions"])
        if report["conflicts"] or (
            not changes and previous and previous.get("versions") and not report["versionChanges"]
        ):
            return report
        if previous:
            backup = state_directory / "backups" / (
                previous["version"] + "-" + str(time.time_ns()) + "-" + str(uuid.uuid4())
            )
            no_symlink(backup)
            for name in previous["files"]:
                atomic_write(backup / name, read_bytes(destination / name))
            atomic_write(backup / RECEIPT, read_bytes(destination / RECEIPT))
            atomic_write(backup / "rollback.json", json_bytes({
                "schemaVersion": "1.0", "destination": str(destination),
                "addedFiles": [item["path"] for item in changes if item["action"] == "add"],
                "restoreFiles": list(previous["files"]), "receipt": RECEIPT,
            }))
            report["backup"] = str(backup)
        for change in changes:
            file = destination / change["path"]
            if change["action"] == "remove":
                no_symlink(file)
                file.unlink()
            else:
                atomic_write(file, files[change["path"]])
        atomic_write(destination / RECEIPT, json_bytes({
            "schemaVersion": "2.0", "namespace": "ps", "version": prepared["manifest"]["version"],
            "versions": report["versions"],
            "installedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "files": {name: digest(content) for name, content in files.items()},
        }))
        report["applied"] = True
        return report
    finally:
        current = file_stat(lock)
        if current is not None and (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
            lock.unlink()


def main(args: Optional[List[str]] = None) -> Dict[str, Any]:
    args = sys.argv[1:] if args is None else args
    if not args or args[0] not in {"version", "check", "install"}:
        raise ValueError("Usage: python3 lifecycle.py version|check|install [--source PATH] [--host-root PATH] [--apply]")
    command, flags = args[0], args[1:]
    options: Dict[str, Any] = {}
    index = 0
    while index < len(flags):
        flag = flags[index]
        if flag not in {"--source", "--host-root", "--apply"} or flag in options:
            raise ValueError("Unknown or duplicate argument: " + flag)
        index += 1
        if flag == "--apply":
            options[flag] = True
        else:
            if index == len(flags) or not flags[index] or flags[index].startswith("--"):
                raise ValueError("Missing value for " + flag)
            options[flag] = flags[index]
            index += 1
    if options.get("--apply") and command != "install":
        raise ValueError("--apply is supported only for install")
    if command == "version" and "--host-root" in options:
        raise ValueError("--host-root is supported only for check or install")
    if command != "version" and not options.get("--source"):
        raise ValueError("--source is required; do not inventory a shared Copilot directory as a source release")
    source = options.get("--source", ROOT)
    if command == "version":
        manifest = read_manifest(source)
        result = {"schemaVersion": "2.0", "namespace": "ps", "version": manifest["version"], **versions(manifest)}
    elif command == "check" and "--host-root" not in options:
        manifest = read_manifest(source)
        files = inventory(source, manifest)
        result = {"schemaVersion": "2.0", "command": command, "version": manifest["version"],
                  "valid": True, "files": len(files), "componentFiles": len(deployment_files(files)),
                  "versions": versions(manifest)}
    else:
        result = install(source, options.get("--host-root"), options.get("--apply", False))
        result["command"] = command
    print(json_bytes(result).decode("utf-8"))
    return result


if __name__ == "__main__":
    try:
        sys.exit(1 if main().get("conflicts") else 0)
    except Exception as error:
        print(json.dumps({"schemaVersion": "2.0", "error": str(error)}), file=sys.stderr)
        sys.exit(1)
