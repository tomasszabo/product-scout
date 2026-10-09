"""Offline lifecycle regression tests; every fixture stays under this directory."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from typing import Any, Dict, Optional
from unittest import mock

sys.dont_write_bytecode = True
TESTS = Path(os.path.abspath(__file__)).parent
SCRIPT = TESTS.parent / "skills/ps-update/scripts/lifecycle.py"
SPEC = importlib.util.spec_from_file_location("ps_lifecycle", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
lifecycle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lifecycle)


class LifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = tempfile.TemporaryDirectory(prefix="lifecycle-python-", dir=TESTS)
        self.addCleanup(self.fixture.cleanup)
        self.root = Path(self.fixture.name)
        self.source = self.root / "release"
        self.host = self.root / "home/.copilot"
        self.manifest: Dict[str, Any] = {
            "schemaVersion": "2.0", "namespace": "ps", "version": "0.1.0",
            "runtimeVersion": "0.6.0",
            "skills": {"ps": "0.6.0", "ps-update": "0.7.0", "ps-version": "0.7.0",
                       "ps-data-refresh": "0.6.0"},
            "agents": {"ps-analyst": "0.3.0"},
            "extensions": {"ps-runtime": "0.5.0"},
            "automations": {"ps-data-refresh": "0.2.0"},
        }
        for name in self.manifest["skills"]:
            self.write(self.source / "skills" / name / "SKILL.md", "# " + name + "\n")
        self.write(self.source / "agents/ps-analyst.agent.md", "# Analyst\n")
        self.write(self.source / "extensions/ps-runtime/extension.mjs", "export const fixture = true;\n")
        self.write(self.source / "automations/ps-data-refresh/SKILL.md",
                   "[refresh](../../skills/ps-data-refresh/SKILL.md)\n")
        for guide in lifecycle.GUIDES:
            self.write(self.source / guide, "# Guide\n")
        self.write(self.source / "README.md",
                   "[setup](docs/setup.md#start) [skill](skills/ps/SKILL.md)\n")
        self.write(self.source / "docs/setup.md",
                   "[home](../README.md) [skill](../skills/ps/SKILL.md) "
                   "[automation](../automations/ps-data-refresh/SKILL.md) "
                   "[web](https://example.test/page) [anchor](#start)\n")
        self.write(self.source / "skills/ps-update/scripts/lifecycle.py", SCRIPT.read_bytes())
        self.save_manifest()

    def write(self, path: Path, content: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))

    def save_manifest(self) -> None:
        self.write(self.source / lifecycle.MANIFEST, json.dumps(self.manifest, indent=2))

    def apply(self) -> Dict[str, Any]:
        return lifecycle.install(self.source, self.host, apply=True)

    def receipt(self) -> Dict[str, Any]:
        return json.loads((self.host / lifecycle.RECEIPT).read_bytes())

    def cli(self, *args: str, script: Optional[Path] = None) -> subprocess.CompletedProcess[str]:
        environment = dict(os.environ, HOME=str(self.root / "home"),
                           PYTHONDONTWRITEBYTECODE="1", PATH=str(self.root / "no-executables"))
        return subprocess.run(
            [sys.executable, "-B", str(script or SCRIPT), *map(str, args)],
            cwd=self.root, env=environment, capture_output=True, text=True, check=False,
        )

    def assert_error(self, result: subprocess.CompletedProcess[str], text: str = "") -> None:
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(result.stdout, "")
        error = json.loads(result.stderr)
        self.assertEqual(error["schemaVersion"], "2.0")
        self.assertIn(text, error["error"])

    def test_dry_run_apply_noop_and_update(self) -> None:
        dry_run = lifecycle.install(self.source, self.host)
        self.assertFalse(self.host.exists())
        self.assertFalse(dry_run["applied"])
        self.assertTrue(all(item["action"] == "add" for item in dry_run["changes"]))
        self.assertTrue(all(item["from"] is None for item in dry_run["versionChanges"]))
        applied = self.apply()
        self.assertTrue(applied["applied"])
        self.assertIsNone(applied["backup"])
        original_receipt = (self.host / lifecycle.RECEIPT).read_bytes()
        noop = self.apply()
        self.assertFalse(noop["applied"])
        self.assertEqual(noop["changes"], [])
        self.assertEqual(noop["versionChanges"], [])
        self.assertEqual(original_receipt, (self.host / lifecycle.RECEIPT).read_bytes())
        path = "skills/ps/SKILL.md"
        previous = (self.host / path).read_bytes()
        self.write(self.source / path, "# Updated\n")
        update = self.apply()
        self.assertTrue(update["applied"])
        self.assertEqual(update["changes"], [{"path": path, "action": "update"}])
        backup = Path(update["backup"])
        self.assertEqual((backup / path).read_bytes(), previous)
        self.assertEqual((backup / lifecycle.RECEIPT).read_bytes(), original_receipt)
        rollback = json.loads((backup / "rollback.json").read_bytes())
        self.assertEqual(rollback["destination"], str(self.host))
        self.assertEqual(rollback["receipt"], lifecycle.RECEIPT)
        self.assertEqual(set(rollback["restoreFiles"]), set(self.receipt()["files"]))
        self.assertFalse((self.host / ".ps/deploy.lock").exists())

    def test_independent_artifact_bump(self) -> None:
        self.apply()
        self.manifest["agents"]["ps-analyst"] = "0.3.1"
        self.save_manifest()
        result = self.apply()
        self.assertEqual(result["versionChanges"],
                         [{"name": "agents/ps-analyst", "from": "0.3.0", "to": "0.3.1"}])
        self.assertEqual(result["versions"]["runtimeVersion"], "0.6.0")
        self.assertEqual(result["versions"]["skills"]["ps-update"], "0.7.0")
        self.assertEqual(self.receipt()["versions"], result["versions"])

    def test_legacy_receipt_versions_migration_without_file_changes(self) -> None:
        self.apply()
        receipt = self.receipt()
        del receipt["versions"]
        legacy_bytes = json.dumps(receipt, separators=(",", ":")).encode()
        self.write(self.host / lifecycle.RECEIPT, legacy_bytes)
        result = self.apply()
        self.assertTrue(result["applied"])
        self.assertEqual(result["changes"], [])
        self.assertTrue(all(change["from"] is None for change in result["versionChanges"]))
        self.assertEqual((Path(result["backup"]) / lifecycle.RECEIPT).read_bytes(), legacy_bytes)
        self.assertTrue(lifecycle.valid_versions(self.receipt()["versions"]))

    def legacy_helper(self) -> tuple[str, bytes]:
        self.apply()
        name, content = "skills/ps-update/scripts/lifecycle.mjs", b"// old JS\r\nexport {};\r\n"
        self.write(self.host / name, content)
        receipt = self.receipt()
        del receipt["versions"]
        receipt["files"][name] = lifecycle.digest(content)
        self.write(self.host / lifecycle.RECEIPT, json.dumps(receipt))
        return name, content

    def test_retired_js_helper_removed_and_backed_up_byte_exact(self) -> None:
        name, content = self.legacy_helper()
        python_path = "skills/ps-update/scripts/lifecycle.py"
        (self.host / python_path).unlink()
        receipt = self.receipt()
        del receipt["files"][python_path]
        self.write(self.host / lifecycle.RECEIPT, json.dumps(receipt))
        result = self.apply()
        self.assertIn({"path": name, "action": "remove"}, result["changes"])
        self.assertIn({"path": python_path, "action": "add"}, result["changes"])
        self.assertFalse((self.host / name).exists())
        self.assertEqual((Path(result["backup"]) / name).read_bytes(), content)
        rollback = json.loads((Path(result["backup"]) / "rollback.json").read_bytes())
        self.assertIn(name, rollback["restoreFiles"])
        self.assertIn(python_path, rollback["addedFiles"])
        self.assertNotIn(name, self.receipt()["files"])
        self.assertTrue((self.host / "skills/ps-update/scripts/lifecycle.py").exists())

    def test_retired_js_helper_local_edit_conflicts(self) -> None:
        name, _ = self.legacy_helper()
        self.write(self.host / name, "edited old helper")
        result = self.apply()
        self.assertEqual(result["conflicts"], [name + ": locally modified or deleted"])
        self.assertFalse(result["applied"])
        self.assertIsNone(result["backup"])
        self.assertEqual((self.host / name).read_text(), "edited old helper")

    def test_unmanaged_collision_even_when_bytes_match(self) -> None:
        path = "agents/ps-analyst.agent.md"
        self.write(self.host / path, (self.source / path).read_bytes())
        result = self.apply()
        self.assertEqual(result["conflicts"], [path + ": unmanaged file collision"])
        self.assertFalse((self.host / ".ps").exists())
        cli = self.cli("install", "--source", self.source, "--host-root", self.host, "--apply")
        self.assertEqual(cli.returncode, 1)
        self.assertEqual(cli.stderr, "")
        self.assertEqual(json.loads(cli.stdout)["conflicts"], result["conflicts"])

    def test_edited_and_deleted_managed_files_conflict(self) -> None:
        self.apply()
        self.write(self.host / "skills/ps/SKILL.md", "local edit")
        (self.host / "agents/ps-analyst.agent.md").unlink()
        result = self.apply()
        self.assertEqual(result["conflicts"], [
            "agents/ps-analyst.agent.md: locally modified or deleted",
            "skills/ps/SKILL.md: locally modified or deleted",
        ])
        self.assertFalse(result["applied"])
        self.assertIsNone(result["backup"])

    def test_nonfile_destination_conflicts(self) -> None:
        (self.host / "skills/ps/SKILL.md").mkdir(parents=True)
        result = self.apply()
        self.assertIn("skills/ps/SKILL.md: destination is not a file", result["conflicts"])
        self.assertFalse(result["applied"])

    def test_obsolete_artifact_removal_ignores_remaining_source_neighbor(self) -> None:
        self.apply()
        del self.manifest["agents"]["ps-analyst"]
        self.save_manifest()
        result = self.apply()
        self.assertIn({"path": "agents/ps-analyst.agent.md", "action": "remove"}, result["changes"])
        self.assertIn({"name": "agents/ps-analyst", "from": "0.3.0", "to": None}, result["versionChanges"])
        self.assertFalse((self.host / "agents/ps-analyst.agent.md").exists())
        self.assertTrue((self.host / "agents").is_dir())

    def test_obsolete_edited_file_not_removed(self) -> None:
        self.apply()
        del self.manifest["agents"]["ps-analyst"]
        self.save_manifest()
        path = self.host / "agents/ps-analyst.agent.md"
        self.write(path, "local agent")
        result = self.apply()
        self.assertFalse(result["applied"])
        self.assertIn("agents/ps-analyst.agent.md: locally modified or deleted", result["conflicts"])
        self.assertEqual(path.read_text(), "local agent")

    def test_preserves_private_state_unrelated_files_and_empty_directories(self) -> None:
        unrelated = {
            ".ps/state.json": b'{"fixture":"private"}',
            "skills/another/SKILL.md": b"unrelated",
            "skills/ps/notes.md": b"unmanaged notes",
            "extensions/another/private.env": b"private fixture",
        }
        for name, content in unrelated.items():
            self.write(self.host / name, content)
        self.apply()
        self.write(self.source / "skills/ps/SKILL.md", "# Next\n")
        self.apply()
        for name, content in unrelated.items():
            self.assertEqual((self.host / name).read_bytes(), content)
            self.assertNotIn(name, self.receipt()["files"])

    def test_inventory_never_visits_undeclared_neighbors_or_tests(self) -> None:
        self.write(self.source / "tests/private.env", "private fixture")
        self.write(self.source / "skills/ps-unlisted/private.env", "private fixture")
        self.write(self.source / "extensions/ps-unlisted/.secret", "private fixture")
        (self.source / "agents/unlisted.agent.md").symlink_to(self.root / "missing")
        self.write(self.source / "automations/unlisted/private.env", "private fixture")
        self.write(self.source / "docs/unlisted.secret", "private fixture")
        unreadable = self.source / "skills/ps-unreadable"
        unreadable.mkdir()
        unreadable.chmod(0)
        try:
            with mock.patch.object(lifecycle.os, "listdir", wraps=os.listdir) as listing:
                files = lifecycle.inventory(self.source, self.manifest)
            paths = [str(call.args[0]) for call in listing.call_args_list]
            self.assertFalse(any(path.endswith(("/skills", "/agents", "/extensions", "/automations", "/tests")) for path in paths))
            self.assertFalse(any("unlisted" in path or "unreadable" in path for path in paths))
            self.assertFalse(any(name.startswith("tests/") for name in files))
            self.assertTrue(self.apply()["applied"])
        finally:
            unreadable.chmod(0o700)

    def test_hidden_private_bytecode_and_dependency_files_rejected(self) -> None:
        for name in (".secret", ".ps/state.json", "__pycache__/file.pyc",
                     "__pycache__/safe.py", "node_modules/file.js", "file.pyc", "private.env"):
            with self.subTest(name=name):
                path = self.source / "skills/ps" / name
                self.write(path, "fixture")
                try:
                    with self.assertRaisesRegex(ValueError, "Unsafe managed path|allowlist"):
                        lifecycle.inventory(self.source, self.manifest)
                finally:
                    path.unlink()
                    if path.parent != self.source / "skills/ps":
                        path.parent.rmdir()
        self.assertFalse(self.host.exists())

    def test_missing_and_wrong_type_named_artifacts(self) -> None:
        for group in lifecycle.ARTIFACT_GROUPS:
            with self.subTest(group=group):
                self.manifest[group]["ps-missing"] = "1.0.0"
                self.save_manifest()
                with self.assertRaisesRegex(ValueError, "Missing release entry"):
                    self.apply()
                path = self.source / group / ("ps-missing.agent.md" if group == "agents" else "ps-missing")
                if group == "agents":
                    path.mkdir()
                else:
                    self.write(path, "not a directory")
                with self.assertRaisesRegex(ValueError, "Expected .*release"):
                    self.apply()
                if group == "agents":
                    path.rmdir()
                else:
                    path.unlink()
                del self.manifest[group]["ps-missing"]
        self.save_manifest()

    def test_empty_declared_directory_rejected(self) -> None:
        (self.source / "skills/ps-empty").mkdir()
        self.manifest["skills"]["ps-empty"] = "1.0.0"
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "Empty release artifact"):
            self.apply()

    def test_required_guides_and_regular_types(self) -> None:
        for name in lifecycle.GUIDES:
            with self.subTest(guide=name):
                path = self.source / name
                content = path.read_bytes()
                path.unlink()
                with self.assertRaisesRegex(ValueError, "Missing release entry"):
                    self.apply()
                path.mkdir()
                with self.assertRaisesRegex(ValueError, "Expected regular release file"):
                    self.apply()
                path.rmdir()
                self.write(path, content)

    def test_invalid_manifests(self) -> None:
        original = json.dumps(self.manifest)
        invalid = [
            ("schemaVersion", "1.0"), ("namespace", "other"), ("version", "01.0.0"),
            ("runtimeVersion", "0.1"), ("managed", []), ("components", None),
        ]
        invalid.extend((group, value) for group in lifecycle.ARTIFACT_GROUPS
                       for value in (None, [], "0.1.0", {"../ps-escape": "1.0.0"},
                                     {"ps-bad": "latest"}, {"ps-bad": 1},
                                     {"ps": "1.0.0"}) if not (group == "skills" and value == {"ps": "1.0.0"}))
        for key, value in invalid:
            with self.subTest(key=key, value=value):
                self.manifest = json.loads(original)
                self.manifest[key] = value
                self.save_manifest()
                with self.assertRaises(ValueError):
                    lifecycle.read_manifest(self.source)
        for group in lifecycle.ARTIFACT_GROUPS:
            self.manifest = json.loads(original)
            del self.manifest[group]
            self.save_manifest()
            with self.assertRaises(ValueError):
                lifecycle.read_manifest(self.source)

    def test_required_skill_dependencies(self) -> None:
        for name in ("ps-update", "ps-version", "ps-data-refresh"):
            with self.subTest(name=name):
                version = self.manifest["skills"].pop(name)
                self.save_manifest()
                with self.assertRaisesRegex(ValueError, "must declare|requires skill"):
                    lifecycle.read_manifest(self.source)
                self.manifest["skills"][name] = version
        self.manifest["automations"] = {}
        del self.manifest["skills"]["ps-data-refresh"]
        self.save_manifest()
        self.assertTrue(lifecycle.read_manifest(self.source))

    def test_duplicate_json_keys_and_nonobjects_rejected(self) -> None:
        for content in ("[]", "null", '{"skills": {}, "skills": {}}', "{"):
            with self.subTest(content=content):
                self.write(self.source / lifecycle.MANIFEST, content)
                with self.assertRaises(ValueError):
                    lifecycle.read_manifest(self.source)

    def test_unsafe_paths_and_receipts(self) -> None:
        for path in ("", "../file.md", "/skills/ps/file.md", "skills//ps/file.md",
                     "skills/./ps/file.md", "skills\\ps\\file.md", "skills/ps/.private",
                     "skills/ps/a\x00.md", "skills/ps/a b.md", ".ps/state.json",
                     "tests/file.py", "skills/ps/node_modules/file.js",
                     "skills/ps/__pycache__/file.py", "skills/ps/file.pyc"):
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    lifecycle.allowed_destination(path)
        self.apply()
        original = self.receipt()
        cases = [
            {**original, "schemaVersion": "1.0"}, {**original, "files": []},
            {**original, "versions": None}, {**original, "files": {".ps/state.json": "a" * 64}},
            {**original, "files": {"skills/ps/file.py": "invalid"}},
            {**original, "files": {"skills/ps/file.py": 123}},
        ]
        for receipt in cases:
            self.write(self.host / lifecycle.RECEIPT, json.dumps(receipt))
            with self.assertRaises(ValueError):
                self.apply()

    def test_source_symlinks_in_root_parent_artifact_file_and_guide(self) -> None:
        alias = self.root / "source-alias"
        alias.symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            lifecycle.read_manifest(alias)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            lifecycle.read_manifest(str(alias) + "/../release")
        alias.unlink()
        for relative in ("skills/ps/SKILL.md", "agents/ps-analyst.agent.md", "README.md",
                         lifecycle.MANIFEST, "skills/ps"):
            with self.subTest(relative=relative):
                path = self.source / relative
                saved = self.root / "saved"
                path.rename(saved)
                path.symlink_to(saved, target_is_directory=saved.is_dir())
                try:
                    with self.assertRaisesRegex(ValueError, "Symlink"):
                        self.apply()
                finally:
                    path.unlink()
                    saved.rename(path)

    def test_destination_symlinks_in_root_parents_files_receipt_and_backups(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        self.host.parent.mkdir(parents=True)
        self.host.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            self.apply()
        self.host.unlink()
        self.apply()
        self.write(self.source / "skills/ps/SKILL.md", "# Next\n")
        for relative in ("skills", "skills/ps/SKILL.md", ".ps", lifecycle.RECEIPT):
            with self.subTest(relative=relative):
                path = self.host / relative
                saved = self.root / "saved"
                path.rename(saved)
                path.symlink_to(saved, target_is_directory=saved.is_dir())
                try:
                    with self.assertRaisesRegex(ValueError, "Symlink"):
                        self.apply()
                finally:
                    path.unlink()
                    saved.rename(path)
        backup_path = self.host / ".ps/backups"
        backup_path.symlink_to(outside, target_is_directory=True)
        try:
            before = (self.host / "skills/ps/SKILL.md").read_bytes()
            with self.assertRaisesRegex(ValueError, "Symlink"):
                self.apply()
            self.assertEqual((self.host / "skills/ps/SKILL.md").read_bytes(), before)
            self.assertEqual(list(outside.iterdir()), [])
            self.assertFalse((self.host / ".ps/deploy.lock").exists())
        finally:
            backup_path.unlink()

    def test_symlink_component_above_destination(self) -> None:
        real = self.root / "real"
        real.mkdir()
        self.host.parent.symlink_to(real, target_is_directory=True)
        try:
            with self.assertRaisesRegex(ValueError, "Symlink"):
                self.apply()
        finally:
            self.host.parent.unlink()

    def test_fifo_source_rejected_without_opening(self) -> None:
        file = self.source / "skills/ps/pipe.py"
        os.mkfifo(file)
        try:
            with self.assertRaisesRegex(ValueError, "Not a regular release file"):
                self.apply()
        finally:
            file.unlink()

    def test_overlapping_roots_and_invalid_destinations(self) -> None:
        for source, host in (
            (self.source, self.source / ".copilot"),
            (self.host / "release", self.host),
            (self.host, self.host),
        ):
            with self.subTest(source=source, host=host):
                with self.assertRaisesRegex(ValueError, "overlap"):
                    lifecycle.install(source, host)
        for host in (".copilot", "relative/.github", self.root, "/", self.root / "ordinary"):
            with self.subTest(host=host):
                with self.assertRaisesRegex(ValueError, "--host-root"):
                    lifecycle.install(self.source, host)
        project_host = self.root / "project/.github"
        self.assertTrue(lifecycle.install(self.source, project_host, apply=True)["applied"])

    def test_cli_options_and_error_contract(self) -> None:
        for args in (
            (), ("unknown",), ("check",), ("install",),
            ("version", "--apply"), ("check", "--source", str(self.source), "--apply"),
            ("version", "--host-root", str(self.host)), ("version", "--source"),
            ("version", "--source", "--apply"), ("version", "--force"),
            ("version", "--source", ""),
            ("install", "--target", str(self.host)), ("version", "--source", str(self.source), "--source", str(self.source)),
            ("install", "--source", str(self.source), "--apply", "--apply"),
            ("install", "--source", str(self.source), "--host-root"),
            ("version", "--source", str(self.source), "extra"),
        ):
            with self.subTest(args=args):
                self.assert_error(self.cli(*args))
        self.assertFalse(self.host.exists())

    def test_runtime_and_deployment_locks(self) -> None:
        for name in ("writer.lock", "deploy.lock"):
            with self.subTest(lock=name):
                path = self.host / ".ps" / name
                self.write(path, "someone else")
                try:
                    with self.assertRaises((ValueError, FileExistsError)):
                        self.apply()
                    self.assertEqual(path.read_text(), "someone else")
                    self.assertFalse((self.host / lifecycle.RECEIPT).exists())
                    if name == "writer.lock":
                        self.assertFalse((self.host / ".ps/deploy.lock").exists())
                finally:
                    path.unlink()
        for name in ("writer.lock", "deploy.lock"):
            path = self.host / ".ps" / name
            path.symlink_to(self.root / "missing-lock-target")
            try:
                with self.assertRaisesRegex(ValueError, "Symlink"):
                    self.apply()
                self.assertTrue(path.is_symlink())
            finally:
                path.unlink()

    def test_replans_after_lock_and_preserves_new_collision(self) -> None:
        original = lifecycle.plan
        count = 0

        def racing_plan(source: Path, host: Path) -> Dict[str, Any]:
            nonlocal count
            count += 1
            if count == 2:
                self.assertTrue((self.host / ".ps/deploy.lock").is_file())
                self.write(self.host / "skills/ps/SKILL.md", "concurrent file")
            return original(source, host)

        with mock.patch.object(lifecycle, "plan", side_effect=racing_plan):
            result = self.apply()
        self.assertEqual(count, 2)
        self.assertFalse(result["applied"])
        self.assertIn("skills/ps/SKILL.md: unmanaged file collision", result["conflicts"])
        self.assertFalse((self.host / ".ps/deploy.lock").exists())

    def test_does_not_release_replaced_deployment_lock(self) -> None:
        original = lifecycle.plan
        count = 0

        def replacing_plan(source: Path, host: Path) -> Dict[str, Any]:
            nonlocal count
            count += 1
            if count == 2:
                lock = self.host / ".ps/deploy.lock"
                lock.rename(self.host / ".ps/original.lock")
                self.write(lock, "replacement owner")
                raise ValueError("injected failure")
            return original(source, host)

        with mock.patch.object(lifecycle, "plan", side_effect=replacing_plan):
            with self.assertRaisesRegex(ValueError, "injected"):
                self.apply()
        self.assertEqual((self.host / ".ps/deploy.lock").read_text(), "replacement owner")

    def test_atomic_failure_cleans_staging_and_releases_own_lock(self) -> None:
        self.apply()
        self.write(self.source / "skills/ps/SKILL.md", "# Next\n")
        before = (self.host / "skills/ps/SKILL.md").read_bytes()
        with mock.patch.object(lifecycle.os, "replace", side_effect=OSError("injected write failure")):
            with self.assertRaisesRegex(OSError, "injected"):
                self.apply()
        self.assertFalse((self.host / ".ps/deploy.lock").exists())
        self.assertEqual(list(self.host.rglob("*.ps-*")), [])
        self.assertEqual((self.host / "skills/ps/SKILL.md").read_bytes(), before)

    def test_deployment_write_failure_retains_complete_rollback_backup(self) -> None:
        self.apply()
        name = "skills/ps/SKILL.md"
        added_name = "skills/ps/new.py"
        old_content = (self.host / name).read_bytes()
        old_receipt = (self.host / lifecycle.RECEIPT).read_bytes()
        self.write(self.source / name, "# Next\n")
        self.write(self.source / added_name, "# New helper\n")
        original_replace = os.replace

        def fail_destination_write(source: Path, destination: Path) -> None:
            if Path(destination) == self.host / name:
                raise OSError("injected deployment write failure")
            original_replace(source, destination)

        with mock.patch.object(lifecycle.os, "replace", side_effect=fail_destination_write):
            with self.assertRaisesRegex(OSError, "injected deployment write failure"):
                self.apply()
        backups = list((self.host / ".ps/backups").iterdir())
        self.assertEqual(len(backups), 1)
        backup = backups[0]
        self.assertEqual((backup / name).read_bytes(), old_content)
        self.assertEqual((backup / lifecycle.RECEIPT).read_bytes(), old_receipt)
        rollback = json.loads((backup / "rollback.json").read_bytes())
        self.assertEqual(rollback["destination"], str(self.host))
        self.assertEqual(rollback["addedFiles"], [added_name])
        previous_files = json.loads(old_receipt)["files"]
        self.assertEqual(set(rollback["restoreFiles"]), set(previous_files))
        for relative, expected_hash in previous_files.items():
            self.assertEqual(lifecycle.digest((backup / relative).read_bytes()), expected_hash)
        self.assertEqual((self.host / name).read_bytes(), old_content)
        self.assertEqual((self.host / lifecycle.RECEIPT).read_bytes(), old_receipt)
        self.assertFalse((self.host / ".ps/deploy.lock").exists())
        self.assertEqual(list(self.host.rglob("*.ps-*")), [])

    def test_atomic_files_have_restrictive_permissions(self) -> None:
        self.apply()
        for name in self.receipt()["files"]:
            self.assertEqual(stat.S_IMODE((self.host / name).stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.host / lifecycle.RECEIPT).stat().st_mode), 0o600)
        self.write(self.source / "skills/ps/SKILL.md", "# Next\n")
        backup = Path(self.apply()["backup"])
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((backup / "skills").stat().st_mode), 0o700)

    def test_old_markdown_hashes_preserve_crlf_and_unicode_bytes(self) -> None:
        content = "# Example café\r\nPlain text\r\n".encode("utf-8")
        self.write(self.source / "skills/ps/SKILL.md", content)
        self.apply()
        self.assertEqual((self.host / "skills/ps/SKILL.md").read_bytes(), content)
        self.assertEqual(self.receipt()["files"]["skills/ps/SKILL.md"], lifecycle.digest(content))
        self.assertEqual(self.apply()["changes"], [])

    def test_guides_automation_and_relative_links_remapped(self) -> None:
        self.apply()
        base = self.host / "skills/ps-update/references"
        self.assertEqual((base / "README.md").read_text(),
                         "[setup](docs/setup.md#start) [skill](../../ps/SKILL.md)\n")
        self.assertEqual((base / "docs/setup.md").read_text(),
                         "[home](../README.md) [skill](../../../ps/SKILL.md) "
                         "[automation](../../../ps-data-refresh/references/automations/ps-data-refresh/automation.md) "
                         "[web](https://example.test/page) [anchor](#start)\n")
        automation = self.host / "skills/ps-data-refresh/references/automations/ps-data-refresh"
        self.assertTrue((automation / "automation.md").exists())
        self.assertFalse((automation / "SKILL.md").exists())
        self.assertEqual((automation / "automation.md").read_text(), "[refresh](../../../SKILL.md)\n")
        for guide in lifecycle.GUIDES:
            self.assertTrue((base / guide).is_file())
        self.assertFalse((self.host / "README.md").exists())
        self.assertFalse((self.host / "automations").exists())
        self.assertFalse((self.host / "tests").exists())

    def test_duplicate_destinations_rejected(self) -> None:
        for relative in ("skills/ps-update/references/README.md",
                         "skills/ps-data-refresh/references/automations/ps-data-refresh/automation.md"):
            with self.subTest(relative=relative):
                self.write(self.source / relative, "collision")
                try:
                    with self.assertRaisesRegex(ValueError, "Duplicate component destination"):
                        self.apply()
                finally:
                    (self.source / relative).unlink()

    def test_version_and_check_cli_contracts(self) -> None:
        version = self.cli("version", "--source", self.source)
        self.assertEqual(version.returncode, 0, version.stderr)
        self.assertEqual(version.stderr, "")
        value = json.loads(version.stdout)
        self.assertEqual(set(value), {"schemaVersion", "namespace", "version", "runtimeVersion",
                                     "skills", "agents", "extensions", "automations"})
        self.assertEqual(value["skills"]["ps-update"], "0.7.0")
        check = self.cli("check", "--source", self.source)
        self.assertEqual(check.returncode, 0, check.stderr)
        value = json.loads(check.stdout)
        self.assertTrue(value["valid"])
        self.assertEqual(value["files"], value["componentFiles"])
        self.assertEqual(value["versions"], lifecycle.versions(self.manifest))
        compare = self.cli("check", "--source", self.source, "--host-root", self.host)
        self.assertEqual(compare.returncode, 0, compare.stderr)
        value = json.loads(compare.stdout)
        self.assertEqual(value["command"], "check")
        self.assertFalse(value["applied"])
        self.assertFalse(self.host.exists())

    def test_default_home_and_installed_version_from_different_cwd_offline(self) -> None:
        dry_run = self.cli("install", "--source", self.source)
        self.assertEqual(dry_run.returncode, 0, dry_run.stderr)
        self.assertEqual(json.loads(dry_run.stdout)["destination"], str(self.host))
        self.assertFalse(self.host.exists())
        apply = self.cli("install", "--source", self.source, "--apply")
        self.assertEqual(apply.returncode, 0, apply.stderr)
        self.assertTrue(json.loads(apply.stdout)["applied"])
        installed_script = self.host / "skills/ps-update/scripts/lifecycle.py"
        version = self.cli("version", script=installed_script)
        self.assertEqual(version.returncode, 0, version.stderr)
        self.assertEqual(json.loads(version.stdout)["runtimeVersion"], self.manifest["runtimeVersion"])
        check = self.cli("check", "--source", self.source, "--host-root", self.host, script=installed_script)
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertEqual(json.loads(check.stdout)["changes"], [])
        source_copy = self.root / "source-offline"
        self.source.rename(source_copy)
        version = self.cli("version", script=installed_script)
        self.assertEqual(version.returncode, 0, version.stderr)
        self.assertFalse(any(self.root.rglob("__pycache__")))

    def test_version_default_checkout_script_ignores_cwd(self) -> None:
        script = self.source / "skills/ps-update/scripts/lifecycle.py"
        result = self.cli("version", script=script)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["skills"], self.manifest["skills"])

    def test_empty_managed_files_remain_noop(self) -> None:
        self.write(self.source / "skills/ps/empty.py", b"")
        self.apply()
        self.assertEqual(self.apply()["changes"], [])

    def test_unmanaged_empty_file_collision_blocks_apply(self) -> None:
        name = "skills/ps/empty.py"
        self.write(self.source / name, b"")
        self.write(self.host / name, b"")
        result = self.apply()
        self.assertEqual(result["conflicts"], [name + ": unmanaged file collision"])
        self.assertFalse(result["applied"])
        self.assertEqual((self.host / name).read_bytes(), b"")
        self.assertFalse((self.host / lifecycle.RECEIPT).exists())
        self.assertFalse((self.host / ".ps").exists())

    def test_json_output_from_main_is_single_document(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = lifecycle.main(["check", "--source", str(self.source)])
        self.assertEqual(json.loads(output.getvalue()), result)


if __name__ == "__main__":
    unittest.main()
