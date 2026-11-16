"""th.live.chat over the `cli` transport (th.live.chat_cli): stream-json parsing, arguments, a fake
process (streaming, errors, cancellation kills the tree) and one real child process tree that a
cancel must leave dead. Never runs the real `claude`."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
import textwrap
import time

import pytest

from th.live import chat, chat_cli


def event(text: str) -> str:
    return json.dumps({
        "type": "stream_event",
        "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}},
    })


def result(text: str = "", is_error: bool = False) -> str:
    return json.dumps({"type": "result", "subtype": "success", "is_error": is_error, "result": text})


class FakeProc:
    """An asyncio Process stand-in: stdout lines, then EOF (exit `code`) or a hang until killed."""

    pid = 424242

    def __init__(self, lines, *, hang=False, code=0, stderr=b""):
        self.lines = [ln.encode() + b"\n" for ln in lines]
        self.hang, self.code, self.err = hang, code, stderr
        self.returncode = None
        self.killed = asyncio.Event()
        self.stdin_data = b""
        self.stdin = self
        self.stdout = self
        self.stderr = _Stderr(self)

    # stdin
    def write(self, data):
        self.stdin_data += data

    async def drain(self):
        pass

    def close(self):
        pass

    # stdout
    async def readline(self):
        await asyncio.sleep(0)
        if self.lines:
            return self.lines.pop(0)
        if self.hang:
            await self.killed.wait()
        if self.returncode is None:
            self.returncode = self.code
        return b""

    async def wait(self):
        if self.returncode is None and self.hang:
            await self.killed.wait()
        if self.returncode is None:
            self.returncode = self.code
        return self.returncode

    def kill(self):
        if self.returncode is None:
            self.returncode = -9
        self.killed.set()


class _Stderr:
    def __init__(self, proc):
        self.proc = proc

    async def read(self):
        return self.proc.err


@pytest.fixture
def cli(monkeypatch):
    """Route chat through the cli transport onto a FakeProc; record tree kills."""
    monkeypatch.delenv(chat.TRANSPORT_ENV, raising=False)  # cli is the default
    monkeypatch.setattr(chat_cli, "command", lambda: ["claude"])
    state = {"taskkill": [], "args": None}

    async def fake_taskkill(pid):
        state["taskkill"].append(pid)

    monkeypatch.setattr(chat_cli, "_taskkill", fake_taskkill)
    monkeypatch.setattr(chat_cli.os, "killpg", lambda pid, sig: state["taskkill"].append(pid), raising=False)

    def install(proc: FakeProc):
        async def fake_spawn(cmd, args):
            state["args"] = args
            return proc

        monkeypatch.setattr(chat_cli, "spawn", fake_spawn)
        return state

    return install


def collect(text, history):
    async def run():
        return [s async for s in chat.reply_sentences(text, history)]

    return asyncio.run(run())


# ---------------------------------------------------------------- pure parts

def test_parser_yields_text_deltas_and_ignores_the_rest():
    p = chat_cli.StreamParser()
    assert p.line(json.dumps({"type": "system", "subtype": "init"})) == []
    assert p.line(b"not json") == []
    assert p.line(event("Hi ")) == ["Hi "]
    assert p.line(result("Hi there.")) == ["\n"]  # text already streamed; the newline ends it
    p.finish(0, "")


def test_parser_falls_back_to_the_result_text():
    p = chat_cli.StreamParser()
    assert p.line(result("Whole reply.")) == ["Whole reply.", "\n"]


def test_parser_errors():
    with pytest.raises(chat_cli.CliError, match="Not logged in"):
        chat_cli.StreamParser().line(result("Not logged in - Please run /login", is_error=True))
    with pytest.raises(chat_cli.CliError, match="exited 1 without a result: warming up boom"):
        chat_cli.StreamParser().finish(1, "warming up\nboom\n")


def test_args_prompt_and_env(monkeypatch):
    args = chat_cli.cli_args("claude-haiku-5-5", "You are Iris.")
    for flag in ("-p", "--include-partial-messages", "--verbose", "--no-session-persistence",
                 "--strict-mcp-config", "--disable-slash-commands"):
        assert flag in args
    assert args[args.index("--output-format") + 1] == "stream-json"
    assert args[args.index("--model") + 1] == "claude-haiku-5-5"
    assert args[args.index("--tools") + 1] == ""
    assert args[args.index("--setting-sources") + 1] == ""
    assert args[args.index("--system-prompt") + 1].startswith("You are Iris.")

    assert chat_cli.cli_prompt([], "hello") == "hello"
    hist = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "Hey."}]
    prompt = chat_cli.cli_prompt(hist, "and now?")
    assert prompt.startswith("<history>\n<turn role=\"user\">\nhi\n</turn>")
    assert prompt.endswith("</history>\n\nand now?")

    monkeypatch.setenv("CLAUDECODE", "1")
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "x")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-no")
    monkeypatch.setenv("ANTHROPIC_KEY_LANE_HACKATHON", "sk-no")
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", "keep")
    env = chat_cli.child_env()
    assert "CLAUDECODE" not in env and "CLAUDE_CODE_SESSION_ID" not in env
    assert "ANTHROPIC_API_KEY" not in env and "ANTHROPIC_KEY_LANE_HACKATHON" not in env
    assert env["CLAUDE_CONFIG_DIR"] == "keep"


# ---------------------------------------------------------------- through reply_sentences

def test_cli_streams_sentences_with_history_in_the_prompt(cli, monkeypatch):
    monkeypatch.delenv(chat.MODEL_ENV, raising=False)
    proc = FakeProc([event("Hi, I'm Iris. "), event("Nice to "), event("meet you!"), result("x")])
    state = cli(proc)
    history = [{"role": "user", "content": "yo"}, {"role": "assistant", "content": "Hey."}]
    assert collect("Introduce yourself.", history) == ["Hi, I'm Iris.", "Nice to meet you!"]
    assert state["args"][state["args"].index("--model") + 1] == "claude-haiku-5-5"
    sent = proc.stdin_data.decode()
    assert "<turn role=\"assistant\">\nHey.\n</turn>" in sent and sent.endswith("Introduce yourself.")
    assert history[-1] == {"role": "assistant", "content": "Hi, I'm Iris. Nice to meet you!"}


def test_result_line_releases_the_last_sentence_before_exit(cli):
    proc = FakeProc([event("Only one sentence."), result("x")], hang=True)  # slow to exit
    cli(proc)

    async def run():
        gen = chat.reply_sentences("hi", [])
        try:
            return await asyncio.wait_for(gen.__anext__(), 2)
        finally:
            await gen.aclose()

    assert asyncio.run(run()) == "Only one sentence."


def test_cancel_kills_the_process_tree(cli):
    proc = FakeProc([event("First sentence. "), event("Second")], hang=True)
    state = cli(proc)

    async def run():
        first = asyncio.Event()

        async def consume():
            async for _ in chat.reply_sentences("hi", []):
                first.set()

        task = asyncio.create_task(consume())
        await asyncio.wait_for(first.wait(), 2)
        assert proc.returncode is None
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert state["taskkill"] == [FakeProc.pid]
    assert proc.returncode == -9


@pytest.mark.parametrize(
    ("proc", "needle"),
    [
        (lambda: FakeProc([result("Not logged in - Please run /login", is_error=True)], code=1), "Not logged in"),
        (lambda: FakeProc([], code=3, stderr=b"fatal: no auth"), "exited 3"),
    ],
)
def test_cli_failures_yield_the_apology(cli, caplog, proc, needle):
    cli(proc())
    with caplog.at_level(logging.ERROR, logger="th.live.chat"):
        assert collect("hello", []) == [chat.API_APOLOGY]
    assert needle in caplog.text


def test_missing_cli_yields_the_setup_apology(monkeypatch, caplog):
    monkeypatch.delenv(chat.TRANSPORT_ENV, raising=False)
    monkeypatch.setenv(chat_cli.COMMAND_ENV, "definitely-not-a-claude-binary")
    with caplog.at_level(logging.WARNING, logger="th.live.chat"):
        assert collect("hello", []) == [chat.NO_KEY_APOLOGY]
    assert "claude CLI not found" in caplog.text


# ---------------------------------------------------------------- a real process tree

CHILD = textwrap.dedent("""
    import json, subprocess, sys, time
    grand = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    open(sys.argv[1], "w").write(str(grand.pid))
    ev = {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello there. Still"}}
    print(json.dumps({"type": "stream_event", "event": ev}), flush=True)
    time.sleep(60)
""")


def _alive(pid: int) -> bool:
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_cancel_kills_a_real_child_and_grandchild(monkeypatch, tmp_path):
    monkeypatch.setenv("TH_HOME", str(tmp_path / "home"))
    monkeypatch.delenv(chat.TRANSPORT_ENV, raising=False)
    script, grand_file = tmp_path / "fake_claude.py", tmp_path / "grand.pid"
    script.write_text(CHILD, encoding="utf-8")
    monkeypatch.setattr(chat_cli, "command", lambda: [sys.executable, str(script), str(grand_file)])
    pids = {}
    real_spawn = chat_cli.spawn

    async def spawn(cmd, args):
        proc = await real_spawn(cmd, args)
        pids["child"] = proc.pid
        return proc

    monkeypatch.setattr(chat_cli, "spawn", spawn)

    async def run():
        gen = chat.reply_sentences("hi", [])
        first = await asyncio.wait_for(gen.__anext__(), 20)
        for _ in range(100):
            if grand_file.exists() and grand_file.read_text():
                break
            await asyncio.sleep(0.05)
        t0 = time.perf_counter()
        await gen.aclose()
        return first, time.perf_counter() - t0

    first, close_s = asyncio.run(run())
    assert first == "Hello there."
    grand = int(grand_file.read_text())
    assert not _alive(pids["child"])
    assert not _alive(grand), "the grandchild survived the tree kill"
    assert close_s < 3.0
