import json
import types

import httpx
import pytest

from lighthouse.llm import AnthropicLLM, OllamaLLM, make_llm


class FakeAnthropicMessages:
    def __init__(self, response_text: str = "ok"):
        self._response_text = response_text
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return types.SimpleNamespace(
            content=[types.SimpleNamespace(text=self._response_text)]
        )


class FakeAnthropicClient:
    def __init__(self, response_text: str = "ok"):
        self.messages = FakeAnthropicMessages(response_text)


def test_ollama_llm_posts_system_and_user_to_chat_endpoint(respx_mock):
    route = respx_mock.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200, json={"message": {"role": "assistant", "content": "hello world"}}
        )
    )

    llm = OllamaLLM(model="qwen2.5:14b-instruct-q4_K_M")
    out = llm("sys prompt", "user prompt")

    assert out == "hello world"
    assert route.called
    body = json.loads(route.calls[0].request.content)
    assert body["model"] == "qwen2.5:14b-instruct-q4_K_M"
    assert body["messages"] == [
        {"role": "system", "content": "sys prompt"},
        {"role": "user", "content": "user prompt"},
    ]
    assert body["stream"] is False
    assert body["options"]["temperature"] == 0.2


def test_ollama_llm_custom_base_url(respx_mock):
    route = respx_mock.post("http://gpu.local:11434/api/chat").mock(
        return_value=httpx.Response(
            200, json={"message": {"content": "ok"}}
        )
    )
    llm = OllamaLLM(base_url="http://gpu.local:11434")
    assert llm("s", "u") == "ok"
    assert route.called


def test_ollama_llm_raises_on_http_error(respx_mock):
    respx_mock.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(500, json={"error": "boom"})
    )
    with pytest.raises(httpx.HTTPStatusError):
        OllamaLLM()("s", "u")


def test_anthropic_llm_calls_messages_create_with_correct_args():
    fake = FakeAnthropicClient("the answer")
    llm = AnthropicLLM(client=fake, model="claude-sonnet-4-6")

    out = llm("system prompt", "user prompt")

    assert out == "the answer"
    call = fake.messages.calls[0]
    assert call["model"] == "claude-sonnet-4-6"
    assert call["system"] == "system prompt"
    assert call["messages"] == [{"role": "user", "content": "user prompt"}]
    assert call["temperature"] == 0.2
    assert call["max_tokens"] > 0


def test_make_llm_defaults_to_ollama(monkeypatch):
    monkeypatch.delenv("LIGHTHOUSE_LLM", raising=False)
    monkeypatch.delenv("OLLAMA_MODEL", raising=False)
    llm = make_llm()
    assert isinstance(llm, OllamaLLM)


def test_make_llm_ollama_honours_model_env(monkeypatch):
    monkeypatch.setenv("LIGHTHOUSE_LLM", "ollama")
    monkeypatch.setenv("OLLAMA_MODEL", "qwen2.5:7b")
    llm = make_llm()
    assert isinstance(llm, OllamaLLM)
    assert llm.model == "qwen2.5:7b"


def test_make_llm_anthropic(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    llm = make_llm("anthropic")
    assert isinstance(llm, AnthropicLLM)


def test_make_llm_unknown_provider_raises():
    with pytest.raises(ValueError):
        make_llm("openai")
