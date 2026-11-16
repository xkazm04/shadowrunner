"""The `cli` transport for live chat: the locally logged-in `claude` CLI in print mode, one process
per turn, streaming text deltas (mirrors the lab's `apps/lab/src/director/llm/cliTransport.ts`).

The process runs in an empty folder ($TH_HOME/live/cli-cwd) with no tools, no MCP servers, no
setting sources and no slash commands, so the only prompt is Iris's. Each call is a fresh process,
so the capped history is rendered into the prompt as a tagged transcript. Closing or cancelling
`text_deltas` kills the process and its children (`taskkill /T /F` on Windows, the process group
elsewhere). Runs on Python 3.10 (the FlashHead env).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path
from typing import AsyncIterator

from ..paths import th_home

log = logging.getLogger("th.live.chat")

COMMAND_ENV = "TH_LIVE_CLAUDE"  # optional path to the claude executable; default `claude` on PATH
TIMEOUT_S = 60.0
KILL_WAIT_S = 3.0
LINE_LIMIT = 1 << 20
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Never handed to the child: a parent Claude Code session's markers (the child must not attach to
# it) and API keys (the CLI would bill a key instead of the owner's login).
_STRIP_EXACT = {"CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"}
_STRIP_PREFIX = ("CLAUDE_CODE_", "ANTHROPIC_KEY_LANE_")

HISTORY_NOTE = (
    "\n\nEarlier turns of this conversation, if any, are quoted in <history> tags at the start of"
    " the message. Answer only the message after them, as Iris, in plain speech without tags."
)


class CliError(RuntimeError):
    """The CLI failed: not logged in, a non-zero exit, an error result or a timeout."""


class CliMissing(CliError):
    """No `claude` executable."""


def cli_cwd() -> Path:
    d = th_home() / "live" / "cli-cwd"
    d.mkdir(parents=True, exist_ok=True)
    return d


def command() -> list[str]:
    """The executable to run, from TH_LIVE_CLAUDE or PATH. Raises CliMissing."""
    configured = os.environ.get(COMMAND_ENV, "").strip()
    exe = shutil.which(configured) if configured else shutil.which("claude")
    if not exe:
        raise CliMissing(f"claude CLI not found ({configured or 'claude'} on PATH)")
    return [exe]


def cli_args(model: str, system: str) -> list[str]:
    """Arguments for `claude` (the prompt goes to stdin)."""
    return [
        "-p",
        "--output-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--model", model,
        "--effort", "low",
        "--tools", "",
        "--system-prompt", system + HISTORY_NOTE,
        "--no-session-persistence",
        "--setting-sources", "",
        "--strict-mcp-config",
        "--disable-slash-commands",
    ]


def cli_prompt(history: list[dict], text: str) -> str:
    """The new message, after the history as a tagged transcript when there is one."""
    if not history:
        return text
    turns = "\n".join(f'<turn role="{m["role"]}">\n{m["content"]}\n</turn>' for m in history)
    return f"<history>\n{turns}\n</history>\n\n{text}"


def child_env() -> dict[str, str]:
    return {
        k: v for k, v in os.environ.items()
        if k not in _STRIP_EXACT and not k.startswith(_STRIP_PREFIX)
    }


class StreamParser:
    """`--output-format stream-json` lines -> text deltas; raises CliError on an error result."""

    def __init__(self) -> None:
        self.saw_text = False
        self.saw_result = False

    def line(self, raw: bytes | str) -> list[str]:
        text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
        try:
            value = json.loads(text)
        except ValueError:
            return []
        if not isinstance(value, dict):
            return []
        if value.get("type") == "stream_event":
            event = value.get("event")
            delta = event.get("delta") if isinstance(event, dict) else None
            if (
                isinstance(delta, dict) and event.get("type") == "content_block_delta"
                and delta.get("type") == "text_delta" and isinstance(delta.get("text"), str)
            ):
                self.saw_text = True
                return [delta["text"]]
            return []
        if value.get("type") == "result":
            self.saw_result = True
            if value.get("is_error"):
                why = value.get("result") if isinstance(value.get("result"), str) else value.get("subtype")
                raise CliError(f"claude CLI returned an error: {str(why)[:300]}")
            # The closing newline ends the last sentence now, not when the process has exited.
            if not self.saw_text and isinstance(value.get("result"), str):
                return [value["result"], "\n"]
            return ["\n"]
        return []

    def finish(self, code: int | None, stderr: str) -> None:
        if self.saw_result and code in (0, None):
            return
        tail = " ".join(stderr.strip().splitlines()[-3:])[:300]
        raise CliError(f"claude CLI exited {code} without a result{': ' + tail if tail else ''}")


async def _taskkill(pid: int) -> None:
    """Kill a Windows process tree (the CLI and anything it started)."""
    proc = await asyncio.create_subprocess_exec(
        "taskkill", "/PID", str(pid), "/T", "/F",
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        creationflags=_NO_WINDOW,
    )
    await asyncio.wait_for(proc.wait(), KILL_WAIT_S)


async def kill_tree(proc) -> None:
    """Kill the process and its children, then reap it. Safe to call on an exited process."""
    if proc.returncode is not None:
        return
    try:
        if os.name == "nt":
            await _taskkill(proc.pid)
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except (OSError, asyncio.TimeoutError) as err:
        log.warning("chat cli: tree kill of %s failed (%s); killing the process", proc.pid, err)
    try:
        proc.kill()
    except (OSError, ProcessLookupError):
        pass
    try:
        await asyncio.wait_for(proc.wait(), KILL_WAIT_S)
    except asyncio.TimeoutError:
        log.error("chat cli: process %s did not exit after kill", proc.pid)


async def spawn(cmd: list[str], args: list[str]):
    """Start the CLI with piped stdio in the empty cwd. Tests replace this with a fake."""
    extra = {"creationflags": _NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
    return await asyncio.create_subprocess_exec(
        *cmd, *args,
        cwd=str(cli_cwd()), env=child_env(), limit=LINE_LIMIT,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, **extra,
    )


async def text_deltas(
    cmd: list[str], system: str, history: list[dict], text: str, model: str
) -> AsyncIterator[str]:
    """The reply's text as it streams. Raises CliError on any failure; the process is always gone
    when this generator ends, is closed or is cancelled."""
    try:
        proc = await spawn(cmd, cli_args(model, system))
    except OSError as err:
        raise CliMissing(f"claude CLI could not start ({cmd[0]}): {err}") from err
    stderr_task = asyncio.ensure_future(proc.stderr.read())
    parser = StreamParser()
    deadline = time.monotonic() + TIMEOUT_S
    try:
        proc.stdin.write(cli_prompt(history, text).encode("utf-8"))
        await proc.stdin.drain()
        proc.stdin.close()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CliError(f"claude CLI timed out after {TIMEOUT_S:.0f} s")
            try:
                line = await asyncio.wait_for(proc.stdout.readline(), remaining)
            except asyncio.TimeoutError:
                raise CliError(f"claude CLI timed out after {TIMEOUT_S:.0f} s") from None
            if not line:
                break
            for delta in parser.line(line):
                yield delta
        code = await asyncio.wait_for(proc.wait(), KILL_WAIT_S)
        stderr = (await asyncio.wait_for(stderr_task, KILL_WAIT_S)).decode("utf-8", "replace")
        parser.finish(code, stderr)
    except (BrokenPipeError, ConnectionResetError) as err:
        raise CliError(f"claude CLI closed its pipes: {err}") from err
    finally:
        await kill_tree(proc)
        stderr_task.cancel()
